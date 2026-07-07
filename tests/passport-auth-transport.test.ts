/**
 * Redirect-pinning for IdP-bound credentialed requests (refresh / public-session mint / poll).
 *
 * These legs carry secrets in the JSON body (refresh_token) or headers (X-Poll-Secret), and
 * undici re-sends bodies and forwards custom headers across cross-origin 307/308 redirects under
 * default-redirect fetch. They must route through the same secure fetch as merchant-bound
 * credentialed requests: a redirect to a foreign origin aborts instead of forwarding the secret.
 */
import { describe, expect, it, vi } from 'vitest';
import { passportLogin, refreshAccessToken } from '../src/passport/auth';

const foreignRedirect = (location: string, status = 307) =>
  vi.fn(async () => new Response(null, { status, headers: { location } })) as unknown as typeof globalThis.fetch;

describe('refreshAccessToken — redirect guard', () => {
  it('REFUSES a cross-origin redirect (refresh_token body never forwarded)', async () => {
    const f = foreignRedirect('https://attacker.example/v1/sessions/refresh');
    await expect(
      refreshAccessToken({ refreshToken: 'oprt_secret', fetch: f }),
    ).rejects.toMatchObject({ code: 'credential_redirect_blocked' });
    expect(f).toHaveBeenCalledTimes(1); // the foreign origin was never fetched
  });

  it('REFUSES a same-host downgrade to http (308 with body re-send)', async () => {
    const f = foreignRedirect('http://api.agentscore.com/v1/sessions/refresh', 308);
    await expect(
      refreshAccessToken({ refreshToken: 'oprt_secret', fetch: f }),
    ).rejects.toMatchObject({ code: 'credential_redirect_blocked' });
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('passportLogin — redirect guard on the public-session legs', () => {
  it('REFUSES a cross-origin redirect on the session mint', async () => {
    const f = foreignRedirect('https://attacker.example/v1/sessions/public');
    await expect(passportLogin({ fetch: f, pollIntervalSeconds: 0 })).rejects.toMatchObject({
      code: 'credential_redirect_blocked',
    });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('REFUSES a cross-origin redirect on the session poll (X-Poll-Secret never forwarded)', async () => {
    const f = vi.fn(async (url: string | URL | Request) => {
      const target = url.toString();
      if (target.endsWith('/v1/sessions/public')) {
        return new Response(
          JSON.stringify({
            session_id: 'sess_redirect',
            poll_secret: 'poll_secret_x',
            verify_url: 'https://www.agentscore.com/verify?session=sess_redirect',
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(null, {
        status: 307,
        headers: { location: 'https://attacker.example/v1/sessions/sess_redirect' },
      });
    }) as unknown as typeof globalThis.fetch;

    await expect(passportLogin({ fetch: f, pollIntervalSeconds: 0 })).rejects.toMatchObject({
      code: 'credential_redirect_blocked',
    });
    expect(f).toHaveBeenCalledTimes(2); // mint + first poll; the foreign origin was never fetched
  });
});
