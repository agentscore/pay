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

  it('returns kind: opted_out when noPassport=true even if a passport is stored', async () => {
    await savePassport(makePassport());
    const result = await attachPassport({ noPassport: true });
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

  describe('silent refresh', () => {
    function withRefresh(overrides: Partial<Passport> = {}): Passport {
      const now = Date.now();
      return {
        version: 1,
        operator_token: 'opc_about_to_expire',
        expires_at: now + 30 * 1000, // 30s left — within REFRESH_THRESHOLD_MS (60s)
        saved_at: now,
        refresh_token: 'prt_test_refresh_token',
        refresh_expires_at: now + 90 * 24 * 60 * 60 * 1000,
        ...overrides,
      };
    }

    it('silently refreshes when access token is within 60s of expiry and saves the new pair', async () => {
      const calls: string[] = [];
      const fetchMock = vi.fn(async (url: string | URL) => {
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

      const stored = withRefresh();
      await savePassport(stored);

      const result = await attachPassport({ fetch: fetchMock });
      expect(result.kind).toBe('attached');
      expect(result.operatorToken).toBe('opc_freshly_minted');
      // Hit /v1/sessions/refresh once.
      expect(calls.filter((c) => c.endsWith('/v1/sessions/refresh'))).toHaveLength(1);

      // Disk got the new pair.
      const reloaded = await loadPassport();
      expect(reloaded?.operator_token).toBe('opc_freshly_minted');
      expect(reloaded?.refresh_token).toBe('prt_freshly_rotated');
    });

    it('does NOT refresh when access token is comfortably away from expiry', async () => {
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

    it('does NOT refresh when the refresh_token itself has expired — surfaces as expired', async () => {
      const fetchMock = vi.fn() as unknown as typeof globalThis.fetch;
      const now = Date.now();
      await savePassport(withRefresh({
        expires_at: now + 30 * 1000,
        refresh_expires_at: now - 1000,
      }));

      const result = await attachPassport({ fetch: fetchMock, now });
      // Access token is still nominally valid, but refresh window has closed —
      // we still attach (access_expires_at hasn't hit zero yet) without a refresh.
      // On the next call when access fully expires, we'll fall through to reauth.
      expect(result.kind).toBe('attached');
      expect((fetchMock as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
    });

    it('falls through to expired when refresh fails (revoked / network)', async () => {
      const fetchMock = vi.fn(async () => new Response(
        JSON.stringify({ error: { code: 'refresh_token_revoked', message: 'Revoked' } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      )) as unknown as typeof globalThis.fetch;

      await savePassport(withRefresh());

      const result = await attachPassport({ fetch: fetchMock });
      expect(result.kind).toBe('expired');
      // Caller (pay.ts) should now drive inline reauth.
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
