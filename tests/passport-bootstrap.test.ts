import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bootstrapFromExpiry,
  bootstrapFromMerchantSession,
  detectMerchantBootstrap,
} from '../src/passport/bootstrap';
import { loadPassport } from '../src/passport/storage';

describe('passport/bootstrap', () => {
  describe('detectMerchantBootstrap', () => {
    it('returns null for non-objects', () => {
      expect(detectMerchantBootstrap(null)).toBeNull();
      expect(detectMerchantBootstrap(undefined)).toBeNull();
      expect(detectMerchantBootstrap('not an object')).toBeNull();
      expect(detectMerchantBootstrap(42)).toBeNull();
    });

    it('returns null when any required field is missing', () => {
      expect(detectMerchantBootstrap({ session_id: 's', poll_secret: 'p' })).toBeNull();
      expect(detectMerchantBootstrap({ session_id: 's', verify_url: 'v' })).toBeNull();
      expect(detectMerchantBootstrap({ poll_secret: 'p', verify_url: 'v' })).toBeNull();
    });

    it('returns the parsed fields when all three required fields are present', () => {
      expect(
        detectMerchantBootstrap({
          session_id: 'sess_abc',
          poll_secret: 'poll_xyz',
          verify_url: 'https://www.agentscore.com/verify?session=sess_abc',
        }),
      ).toEqual({
        session_id: 'sess_abc',
        poll_secret: 'poll_xyz',
        verify_url: 'https://www.agentscore.com/verify?session=sess_abc',
        poll_url: undefined,
        order_id: undefined,
      });
    });

    it('preserves optional poll_url + order_id when present', () => {
      expect(
        detectMerchantBootstrap({
          session_id: 's',
          poll_secret: 'p',
          verify_url: 'v',
          poll_url: 'https://api.x/v1/sessions/s',
          order_id: 'ord_123',
        }),
      ).toMatchObject({ poll_url: 'https://api.x/v1/sessions/s', order_id: 'ord_123' });
    });

    it('ignores extra fields without choking', () => {
      const result = detectMerchantBootstrap({
        session_id: 's',
        poll_secret: 'p',
        verify_url: 'v',
        random_extra: 'whatever',
        agent_instructions: 'string-or-object',
      });
      expect(result).not.toBeNull();
    });
  });

  describe('bootstrapFromMerchantSession (cold-start)', () => {
    let tmp: string;
    let prevHome: string | undefined;
    let prevFetch: typeof globalThis.fetch;

    beforeEach(async () => {
      tmp = await mkdtemp(join(tmpdir(), 'pay-bootstrap-merchant-'));
      prevHome = process.env.AGENTSCORE_PAY_HOME;
      process.env.AGENTSCORE_PAY_HOME = tmp;
      prevFetch = globalThis.fetch;
    });
    afterEach(async () => {
      if (prevHome === undefined) delete process.env.AGENTSCORE_PAY_HOME;
      else process.env.AGENTSCORE_PAY_HOME = prevHome;
      globalThis.fetch = prevFetch;
      await rm(tmp, { recursive: true, force: true });
    });

    it('resumes the merchant-supplied session — does NOT call /v1/sessions/public', async () => {
      const calls: string[] = [];
      const fetchMock = vi.fn(async (url: string | URL) => {
        const target = url.toString();
        calls.push(target);
        // Verified on first poll.
        return new Response(
          JSON.stringify({
            session_id: 'sess_merchant',
            status: 'verified',
            operator_token: 'opc_from_merchant_session',
            token_ttl_seconds: 30 * 24 * 60 * 60,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as unknown as typeof globalThis.fetch;

      const verifyUrls: string[] = [];
      const result = await bootstrapFromMerchantSession(
        {
          session_id: 'sess_merchant',
          poll_secret: 'poll_merchant',
          verify_url: 'https://www.agentscore.com/verify?session=sess_merchant',
          poll_url: 'https://api.example/v1/sessions/sess_merchant',
        },
        {
          fetch: fetchMock,
          pollIntervalSeconds: 0,
          onVerifyUrl: (u) => verifyUrls.push(u),
        },
      );

      expect(result.passport.operator_token).toBe('opc_from_merchant_session');
      // Importantly: no POST to /v1/sessions/public — we're using the merchant's mint.
      expect(calls.some((c) => c.includes('/v1/sessions/public'))).toBe(false);
      expect(calls.some((c) => c.includes('/v1/sessions/sess_merchant'))).toBe(true);
      expect(verifyUrls).toEqual(['https://www.agentscore.com/verify?session=sess_merchant']);

      const stored = await loadPassport();
      expect(stored?.operator_token).toBe('opc_from_merchant_session');
    });

    it('SECURITY: ignores a merchant poll_url pointing at an untrusted host — never fetches/stores a token from it', async () => {
      // A hostile merchant 403 surfaces a poll_url on an attacker-controlled
      // host. The fix must pin the poll to the trusted AgentScore base; the
      // attacker host must NEVER be contacted, so its attacker-chosen
      // operator_token can never reach the durable Passport.
      const calls: string[] = [];
      const fetchMock = vi.fn(async (url: string | URL) => {
        const target = url.toString();
        calls.push(target);
        // If the attacker host is ever hit, return a token we then assert is
        // NOT what got stored — but the host should not be hit at all.
        if (target.includes('attacker.example')) {
          return new Response(
            JSON.stringify({
              session_id: 'sess_evil',
              status: 'verified',
              operator_token: 'opc_ATTACKER_POISON',
              token_ttl_seconds: 30 * 24 * 60 * 60,
              refresh_token: 'refresh_ATTACKER_POISON',
              refresh_token_ttl_seconds: 90 * 24 * 60 * 60,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        // Trusted AgentScore base: legitimate verified session.
        return new Response(
          JSON.stringify({
            session_id: 'sess_evil',
            status: 'verified',
            operator_token: 'opc_trusted',
            token_ttl_seconds: 30 * 24 * 60 * 60,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as unknown as typeof globalThis.fetch;

      const result = await bootstrapFromMerchantSession(
        {
          session_id: 'sess_evil',
          poll_secret: 'poll_evil',
          verify_url: 'https://www.agentscore.com/verify?session=sess_evil',
          poll_url: 'https://api.attacker.example/v1/sessions/sess_evil',
        },
        { fetch: fetchMock, pollIntervalSeconds: 0 },
      );

      // The attacker host was never contacted.
      expect(calls.some((c) => c.includes('attacker.example'))).toBe(false);
      // The poll targeted the trusted AgentScore base.
      expect(calls.some((c) => c.includes('api.agentscore.com/v1/sessions/sess_evil'))).toBe(true);
      // The attacker's token never reached the (in-memory result or) durable Passport.
      expect(result.passport.operator_token).toBe('opc_trusted');
      expect(result.passport.operator_token).not.toBe('opc_ATTACKER_POISON');
      expect(result.passport.refresh_token).toBeUndefined();

      const stored = await loadPassport();
      expect(stored?.operator_token).toBe('opc_trusted');
      expect(stored?.operator_token).not.toBe('opc_ATTACKER_POISON');
    });

    it('SECURITY: respects a test baseUrl override but still ignores the merchant poll_url host', async () => {
      // The non-merchant baseUrl override (used by tests / env) is honored as
      // the trusted base; a divergent merchant poll_url host is still ignored.
      const calls: string[] = [];
      const fetchMock = vi.fn(async (url: string | URL) => {
        calls.push(url.toString());
        return new Response(
          JSON.stringify({
            session_id: 'sess_ovr',
            status: 'verified',
            operator_token: 'opc_trusted_override',
            token_ttl_seconds: 30 * 24 * 60 * 60,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as unknown as typeof globalThis.fetch;

      const result = await bootstrapFromMerchantSession(
        {
          session_id: 'sess_ovr',
          poll_secret: 'poll_ovr',
          verify_url: 'https://www.agentscore.com/verify?session=sess_ovr',
          poll_url: 'https://api.attacker.example/v1/sessions/sess_ovr',
        },
        {
          fetch: fetchMock,
          pollIntervalSeconds: 0,
          baseUrl: 'https://trusted-test-host.example',
        },
      );

      expect(result.passport.operator_token).toBe('opc_trusted_override');
      expect(calls.some((c) => c.includes('attacker.example'))).toBe(false);
      expect(calls.every((c) => c.startsWith('https://trusted-test-host.example/'))).toBe(true);
    });
  });

  describe('bootstrapFromExpiry (mid-stream reauth)', () => {
    let tmp: string;
    let prevHome: string | undefined;
    let prevFetch: typeof globalThis.fetch;

    beforeEach(async () => {
      tmp = await mkdtemp(join(tmpdir(), 'pay-bootstrap-expiry-'));
      prevHome = process.env.AGENTSCORE_PAY_HOME;
      process.env.AGENTSCORE_PAY_HOME = tmp;
      prevFetch = globalThis.fetch;
    });
    afterEach(async () => {
      if (prevHome === undefined) delete process.env.AGENTSCORE_PAY_HOME;
      else process.env.AGENTSCORE_PAY_HOME = prevHome;
      globalThis.fetch = prevFetch;
      await rm(tmp, { recursive: true, force: true });
    });

    it('mints a fresh session via /v1/sessions/public + polls + saves', async () => {
      const calls: { url: string; init?: RequestInit }[] = [];
      const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
        const target = url.toString();
        calls.push({ url: target, init });
        if (target.endsWith('/v1/sessions/public')) {
          return new Response(
            JSON.stringify({
              session_id: 'sess_renewal',
              poll_secret: 'poll_renewal',
              verify_url: 'https://www.agentscore.com/verify?session=sess_renewal',
              poll_url: 'https://api.agentscore.com/v1/sessions/sess_renewal',
              expires_at: new Date(Date.now() + 3600_000).toISOString(),
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } },
          );
        }
        // Verified on first poll.
        return new Response(
          JSON.stringify({
            session_id: 'sess_renewal',
            status: 'verified',
            operator_token: 'opc_renewed',
            token_ttl_seconds: 30 * 24 * 60 * 60,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as unknown as typeof globalThis.fetch;

      const result = await bootstrapFromExpiry({ fetch: fetchMock, pollIntervalSeconds: 0 });
      expect(result.passport.operator_token).toBe('opc_renewed');

      // The mint hit /v1/sessions/public WITH the X-Client-Id header.
      const mintCall = calls.find((c) => c.url.endsWith('/v1/sessions/public'));
      expect(mintCall).toBeDefined();
      const headers = (mintCall!.init?.headers ?? {}) as Record<string, string>;
      expect(headers['X-Client-Id']).toBe('agentscore_pay_pubclient_v1');

      const stored = await loadPassport();
      expect(stored?.operator_token).toBe('opc_renewed');
    });
  });
});
