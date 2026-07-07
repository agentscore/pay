import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachPassport, attachResultToHeaders } from '../src/passport/attach';
import { loadPassport, savePassport, type Passport } from '../src/passport/storage';

describe('passport/attach', () => {
  let tmp: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pay-attach-'));
    prevHome = process.env.AGENTSCORE_PAY_HOME;
    process.env.AGENTSCORE_PAY_HOME = tmp;
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.AGENTSCORE_PAY_HOME;
    else process.env.AGENTSCORE_PAY_HOME = prevHome;
    await rm(tmp, { recursive: true, force: true });
  });

  function makePassport(overrides: Partial<Passport> = {}): Passport {
    return {
      version: 1,
      operator_token: 'opc_test_xyz',
      expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
      saved_at: Date.now(),
      ...overrides,
    };
  }

  it('returns kind: absent when no passport stored', async () => {
    const result = await attachPassport();
    expect(result.kind).toBe('absent');
    expect(attachResultToHeaders(result)).toEqual({});
  });

  it('returns kind: opted_out when skipPassport=true even if a passport is stored', async () => {
    await savePassport(makePassport());
    const result = await attachPassport({ skipPassport: true });
    expect(result.kind).toBe('opted_out');
    expect(attachResultToHeaders(result)).toEqual({});
  });

  it('returns kind: opted_out when caller already supplied X-Operator-Token', async () => {
    await savePassport(makePassport());
    const result = await attachPassport({ callerSuppliedOperatorToken: 'opc_caller' });
    expect(result.kind).toBe('opted_out');
  });

  it('returns kind: attached + operator_token when valid passport stored', async () => {
    await savePassport(makePassport({ operator_token: 'opc_valid_token' }));
    const result = await attachPassport();
    expect(result.kind).toBe('attached');
    expect(result.operatorToken).toBe('opc_valid_token');
    expect(attachResultToHeaders(result)).toEqual({ 'X-Operator-Token': 'opc_valid_token' });
  });

  describe('credential-transport guard (targetUrl)', () => {
    it('returns kind: insecure_target and withholds the token for a cleartext http target', async () => {
      await savePassport(makePassport({ operator_token: 'opc_should_not_leak' }));
      const result = await attachPassport({ targetUrl: 'http://merchant.example/api' });
      expect(result.kind).toBe('insecure_target');
      expect(result.operatorToken).toBeUndefined();
      expect(attachResultToHeaders(result)).toEqual({});
    });

    it('refuses an http target BEFORE reading/refreshing the passport (no fetch call)', async () => {
      const fetchMock = vi.fn() as unknown as typeof globalThis.fetch;
      await savePassport(makePassport());
      const result = await attachPassport({ targetUrl: 'http://merchant.example/api', fetch: fetchMock });
      expect(result.kind).toBe('insecure_target');
      expect((fetchMock as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
    });

    it('attaches normally for an https target', async () => {
      await savePassport(makePassport({ operator_token: 'opc_https_ok' }));
      const result = await attachPassport({ targetUrl: 'https://merchant.example/api' });
      expect(result.kind).toBe('attached');
      expect(result.operatorToken).toBe('opc_https_ok');
    });

    it('allows http for loopback (dev carve-out)', async () => {
      await savePassport(makePassport({ operator_token: 'opc_local' }));
      const result = await attachPassport({ targetUrl: 'http://localhost:3000/api' });
      expect(result.kind).toBe('attached');
      expect(result.operatorToken).toBe('opc_local');
    });

    it('attachResultToHeaders withholds the token when given a non-https targetUrl', async () => {
      await savePassport(makePassport({ operator_token: 'opc_valid_token' }));
      const result = await attachPassport();
      expect(result.kind).toBe('attached');
      // Even on an attached result, an unsafe targetUrl at the attach point withholds the header.
      expect(attachResultToHeaders(result, 'http://merchant.example/api')).toEqual({});
      expect(attachResultToHeaders(result, 'https://merchant.example/api')).toEqual({
        'X-Operator-Token': 'opc_valid_token',
      });
    });
  });

  it('returns kind: expired when stored passport past expiry', async () => {
    const past = Date.now() - 1000;
    await savePassport(makePassport({ expires_at: past }));
    const result = await attachPassport();
    expect(result.kind).toBe('expired');
    expect(result.passport).toBeDefined();
    expect(attachResultToHeaders(result)).toEqual({});
  });

  it('flags expiringSoon=true when within 5 days of expiry', async () => {
    const now = Date.now();
    const passport = makePassport({ expires_at: now + 4 * 24 * 60 * 60 * 1000 });
    await savePassport(passport);
    const result = await attachPassport({ now });
    expect(result.kind).toBe('attached');
    expect(result.expiringSoon).toBe(true);
  });

  it('expiringSoon=false when comfortably away from expiry', async () => {
    const now = Date.now();
    const passport = makePassport({ expires_at: now + 20 * 24 * 60 * 60 * 1000 });
    await savePassport(passport);
    const result = await attachPassport({ now });
    expect(result.kind).toBe('attached');
    expect(result.expiringSoon).toBe(false);
  });

  it('expiringSoon=false even with short-lived access when refresh_token is comfortably valid', async () => {
    // Post-silent-refresh-fix: access tokens get rotated to 24h on every
    // refresh. If the user-actionable warning fired on every pay call
    // (because 24h < 5d), it would be misleading — the user does NOT
    // need to re-verify; pay refreshes silently. expiringSoon should
    // reflect "user action needed", not just access remaining life.
    const now = Date.now();
    await savePassport({
      version: 1,
      operator_token: 'opc_short_access_long_refresh',
      expires_at: now + 24 * 60 * 60 * 1000, // 24h, well inside 5d window
      saved_at: now,
      refresh_token: 'prt_test',
      refresh_expires_at: now + 90 * 24 * 60 * 60 * 1000, // 90d
    });
    const result = await attachPassport({ now });
    expect(result.kind).toBe('attached');
    expect(result.expiringSoon).toBe(false);
  });

  it('expiringSoon=true when access AND refresh both near expiry (user must re-verify)', async () => {
    // The case where the warning is genuinely useful: refresh is about
    // to expire too, so the user actually needs to passport login again.
    const now = Date.now();
    await savePassport({
      version: 1,
      operator_token: 'opc_access_near_end',
      expires_at: now + 4 * 24 * 60 * 60 * 1000, // 4d
      saved_at: now,
      refresh_token: 'prt_also_near_end',
      refresh_expires_at: now + 3 * 24 * 60 * 60 * 1000, // 3d — within 5d window
    });
    const result = await attachPassport({ now });
    expect(result.kind).toBe('attached');
    expect(result.expiringSoon).toBe(true);
  });

  describe('silent refresh', () => {
    function withRefresh(overrides: Partial<Passport> = {}): Passport {
      const now = Date.now();
      return {
        version: 1,
        operator_token: 'opc_about_to_expire',
        // Default: access token within the proactive refresh window
        // (REFRESH_THRESHOLD_MS = 5 min). Override per-test to exercise
        // the reactive path (negative remaining life) or far-from-expiry.
        expires_at: now + 30 * 1000,
        saved_at: now,
        refresh_token: 'prt_test_refresh_token',
        refresh_expires_at: now + 90 * 24 * 60 * 60 * 1000,
        ...overrides,
      };
    }

    function refreshSuccessFetch(calls: string[]): typeof globalThis.fetch {
      return vi.fn(async (url: string | URL) => {
        calls.push(url.toString());
        return new Response(
          JSON.stringify({
            operator_token: 'opc_freshly_minted',
            token_ttl_seconds: 24 * 60 * 60,
            refresh_token: 'prt_freshly_rotated',
            refresh_token_ttl_seconds: 90 * 24 * 60 * 60,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as unknown as typeof globalThis.fetch;
    }

    // ── Proactive: access still valid but within REFRESH_THRESHOLD_MS ──

    it('proactively refreshes when access is within the threshold of expiry', async () => {
      const calls: string[] = [];
      const fetchMock = refreshSuccessFetch(calls);

      // 30s remaining is well inside REFRESH_THRESHOLD_MS (5 min).
      await savePassport(withRefresh());

      const result = await attachPassport({ fetch: fetchMock });
      expect(result.kind).toBe('attached');
      expect(result.operatorToken).toBe('opc_freshly_minted');
      expect(calls.filter((c) => c.endsWith('/v1/sessions/refresh'))).toHaveLength(1);

      // Disk got the new pair.
      const reloaded = await loadPassport();
      expect(reloaded?.operator_token).toBe('opc_freshly_minted');
      expect(reloaded?.refresh_token).toBe('prt_freshly_rotated');
    });

    // ── Reactive: access has already expired but refresh_token is valid ──
    // This is the dominant real-world case — agent comes back after the 24h
    // access TTL but well within the 90d refresh TTL. Pre-fix, this path
    // short-circuited to 'expired' and forced bootstrap reauth.

    it('reactively refreshes when access already expired but refresh_token still valid', async () => {
      const calls: string[] = [];
      const fetchMock = refreshSuccessFetch(calls);
      const now = Date.now();

      // Access expired 1 hour ago; refresh_token still valid for 90 days.
      await savePassport(
        withRefresh({
          expires_at: now - 60 * 60 * 1000,
          refresh_expires_at: now + 90 * 24 * 60 * 60 * 1000,
        }),
      );

      const result = await attachPassport({ fetch: fetchMock, now });
      expect(result.kind).toBe('attached');
      expect(result.operatorToken).toBe('opc_freshly_minted');
      expect(calls.filter((c) => c.endsWith('/v1/sessions/refresh'))).toHaveLength(1);
    });

    // ── No refresh attempted ──

    it('does NOT refresh when access is comfortably away from expiry', async () => {
      const fetchMock = vi.fn() as unknown as typeof globalThis.fetch;
      const now = Date.now();
      await savePassport(withRefresh({ expires_at: now + 24 * 60 * 60 * 1000 }));

      const result = await attachPassport({ fetch: fetchMock, now });
      expect(result.kind).toBe('attached');
      expect(result.operatorToken).toBe('opc_about_to_expire');
      expect((fetchMock as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
    });

    it('does NOT refresh when there is no refresh_token (legacy passport)', async () => {
      const fetchMock = vi.fn() as unknown as typeof globalThis.fetch;
      await savePassport({
        version: 1,
        operator_token: 'opc_legacy',
        expires_at: Date.now() + 30 * 1000,
        saved_at: Date.now(),
      });

      const result = await attachPassport({ fetch: fetchMock });
      expect(result.kind).toBe('attached');
      expect(result.operatorToken).toBe('opc_legacy');
      expect((fetchMock as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
    });

    it('does NOT refresh when refresh_token itself has expired (access still nominally valid)', async () => {
      const fetchMock = vi.fn() as unknown as typeof globalThis.fetch;
      const now = Date.now();
      await savePassport(
        withRefresh({
          expires_at: now + 30 * 1000,
          refresh_expires_at: now - 1000,
        }),
      );

      const result = await attachPassport({ fetch: fetchMock, now });
      // Access still has 30s — attach uses it. When access expires next
      // time, this same hasUsableRefresh=false path falls through to expired.
      expect(result.kind).toBe('attached');
      expect((fetchMock as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
    });

    // ── Refresh failure paths ──

    it('proactive refresh failure with still-valid access → uses the existing access (graceful)', async () => {
      const fetchMock = vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: 'refresh_token_revoked', message: 'Revoked' } }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          ),
      ) as unknown as typeof globalThis.fetch;
      const now = Date.now();

      // Access has 30s of life, refresh attempt fails. Better to use the
      // still-valid access than to drive bootstrap eagerly on a transient
      // refresh failure.
      await savePassport(withRefresh({ expires_at: now + 30 * 1000 }));

      const result = await attachPassport({ fetch: fetchMock, now });
      expect(result.kind).toBe('attached');
      expect(result.operatorToken).toBe('opc_about_to_expire');
    });

    it('reactive refresh failure with already-expired access → returns expired', async () => {
      const fetchMock = vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: 'refresh_token_revoked', message: 'Revoked' } }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          ),
      ) as unknown as typeof globalThis.fetch;
      const now = Date.now();

      // Access expired AND refresh fails — caller (pay.ts) now drives
      // inline bootstrap reauth via the verify-URL flow.
      await savePassport(
        withRefresh({
          expires_at: now - 60 * 60 * 1000,
          refresh_expires_at: now + 90 * 24 * 60 * 60 * 1000,
        }),
      );

      const result = await attachPassport({ fetch: fetchMock, now });
      expect(result.kind).toBe('expired');
    });

    it('honors skipRefresh flag (testing surface)', async () => {
      const fetchMock = vi.fn() as unknown as typeof globalThis.fetch;
      await savePassport(withRefresh());

      const result = await attachPassport({ fetch: fetchMock, skipRefresh: true });
      expect(result.kind).toBe('attached');
      expect(result.operatorToken).toBe('opc_about_to_expire');
      expect((fetchMock as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
    });
  });
});
