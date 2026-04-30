import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  passportLoginCommand,
  passportLogoutCommand,
  passportStatusCommand,
} from '../src/commands/passport';
import { savePassport } from '../src/passport/storage';

describe('passport commands', () => {
  let tmp: string;
  let prevHome: string | undefined;
  let prevKey: string | undefined;
  let prevFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pay-passport-cmd-'));
    prevHome = process.env.AGENTSCORE_PAY_HOME;
    process.env.AGENTSCORE_PAY_HOME = tmp;
    prevKey = process.env.AGENTSCORE_API_KEY;
    delete process.env.AGENTSCORE_API_KEY;
    prevFetch = globalThis.fetch;
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.AGENTSCORE_PAY_HOME;
    else process.env.AGENTSCORE_PAY_HOME = prevHome;
    if (prevKey !== undefined) process.env.AGENTSCORE_API_KEY = prevKey;
    globalThis.fetch = prevFetch;
    await rm(tmp, { recursive: true, force: true });
  });

  describe('passportLoginCommand', () => {
    it('mints a session, polls until verified, saves the passport', async () => {
      const calls: { url: string; init?: RequestInit }[] = [];
      let pollCount = 0;
      globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
        const target = url.toString();
        calls.push({ url: target, init });
        if (target.endsWith('/v1/sessions/public') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              session_id: 'sess_abc',
              poll_secret: 'poll_xyz',
              verify_url: 'https://agentscore.sh/verify?session=sess_abc',
              poll_url: 'https://api.agentscore.sh/v1/sessions/sess_abc',
              expires_at: new Date(Date.now() + 3600_000).toISOString(),
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (target.includes('/v1/sessions/sess_abc')) {
          pollCount += 1;
          if (pollCount < 2) {
            return new Response(JSON.stringify({ session_id: 'sess_abc', status: 'pending' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(
            JSON.stringify({
              session_id: 'sess_abc',
              status: 'verified',
              operator_token: 'opc_real_token',
              completed_at: new Date().toISOString(),
              token_ttl_seconds: 30 * 24 * 60 * 60,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        throw new Error(`unexpected fetch ${target}`);
      }) as unknown as typeof globalThis.fetch;

      const verifyUrls: string[] = [];
      const result = await passportLoginCommand({
        pollIntervalSeconds: 0, // tight loop for tests
        timeoutSeconds: 30,
        onVerifyUrl: (u) => verifyUrls.push(u),
      });

      expect(result.ok).toBe(true);
      expect(result.operator_token_prefix).toBe('opc_real…');
      expect(result.expires_in_days).toBeGreaterThanOrEqual(29);
      expect(verifyUrls).toEqual(['https://agentscore.sh/verify?session=sess_abc']);
      expect(pollCount).toBe(2);
    });

    it('throws passport_verification_failed when poll status is denied', async () => {
      let polled = false;
      globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
        const target = url.toString();
        if (target.endsWith('/v1/sessions/public') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              session_id: 'sess_deny',
              poll_secret: 'poll_x',
              verify_url: 'https://agentscore.sh/verify?session=sess_deny',
              poll_url: 'https://api.agentscore.sh/v1/sessions/sess_deny',
              expires_at: new Date(Date.now() + 3600_000).toISOString(),
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (target.includes('/v1/sessions/sess_deny')) {
          polled = true;
          return new Response(
            JSON.stringify({ session_id: 'sess_deny', status: 'denied' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        throw new Error(`unexpected fetch ${target}`);
      }) as unknown as typeof globalThis.fetch;

      await expect(
        passportLoginCommand({ pollIntervalSeconds: 0 }),
      ).rejects.toMatchObject({ code: 'passport_verification_failed' });
      expect(polled).toBe(true);
    });

    it('rejects with config_error when SDK returns 401 (invalid API key)', async () => {
      globalThis.fetch = vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: 'invalid_credential', message: 'bad key' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ) as unknown as typeof globalThis.fetch;

      await expect(passportLoginCommand({})).rejects.toMatchObject({
        code: 'config_error',
      });
    });

    it('rejects with passport_api_error when SDK returns 5xx', async () => {
      globalThis.fetch = vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: 'api_error', message: 'down' } }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
      ) as unknown as typeof globalThis.fetch;

      await expect(passportLoginCommand({})).rejects.toMatchObject({
        code: 'passport_api_error',
      });
    });

    it('throws passport_verification_timeout when polling exceeds timeoutSeconds', async () => {
      globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
        const target = url.toString();
        if (target.endsWith('/v1/sessions/public') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              session_id: 'sess_timeout',
              poll_secret: 'poll_x',
              verify_url: 'https://agentscore.sh/verify?session=sess_timeout',
              poll_url: 'https://api.agentscore.sh/v1/sessions/sess_timeout',
              expires_at: new Date(Date.now() + 3600_000).toISOString(),
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({ session_id: 'sess_timeout', status: 'pending' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as unknown as typeof globalThis.fetch;

      await expect(
        passportLoginCommand({ pollIntervalSeconds: 0, timeoutSeconds: 0 }),
      ).rejects.toMatchObject({ code: 'passport_verification_timeout' });
    });
  });

  describe('passportStatusCommand', () => {
    it('returns authenticated:false when no passport stored', async () => {
      const result = await passportStatusCommand();
      expect(result).toEqual({ authenticated: false });
    });

    it('returns authenticated:true with token prefix + expiry when passport stored', async () => {
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      await savePassport({
        version: 1,
        operator_token: 'opc_test_value',
        expires_at: expiresAt,
        saved_at: Date.now(),
      });
      const result = await passportStatusCommand();
      expect(result).toMatchObject({
        authenticated: true,
        operator_token_prefix: 'opc_test…',
        expired: false,
      });
    });
  });

  describe('passportLogoutCommand', () => {
    it('clears local passport and returns cleared=true; revoked_remote=false without API key', async () => {
      await savePassport({
        version: 1,
        operator_token: 'opc_local_only',
        expires_at: Date.now() + 1000,
        saved_at: Date.now(),
      });
      const result = await passportLogoutCommand();
      expect(result).toEqual({ ok: true, cleared: true, revoked_remote: false });
      const status = await passportStatusCommand();
      expect(status.authenticated).toBe(false);
    });

    it('returns cleared=false when there was no passport to clear', async () => {
      const result = await passportLogoutCommand();
      expect(result).toEqual({ ok: true, cleared: false, revoked_remote: false });
    });
  });
});
