import { describe, expect, it, vi } from 'vitest';
import {
  assertCredentialTarget,
  createSecureFetch,
  isCredentialSafeUrl,
  isLoopbackHost,
} from '../src/url-security';

describe('url-security: isLoopbackHost', () => {
  it('recognizes localhost / 127.0.0.1 / ::1 (and bracketed IPv6)', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('LOCALHOST')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
  });

  it('rejects non-loopback hosts (including lookalikes)', () => {
    expect(isLoopbackHost('example.com')).toBe(false);
    expect(isLoopbackHost('127.0.0.2')).toBe(false);
    expect(isLoopbackHost('localhost.attacker.com')).toBe(false);
    expect(isLoopbackHost('169.254.169.254')).toBe(false);
  });
});

describe('url-security: isCredentialSafeUrl', () => {
  it('accepts https targets', () => {
    expect(isCredentialSafeUrl('https://merchant.example/api')).toBe(true);
    expect(isCredentialSafeUrl('https://merchant.example:8443/api')).toBe(true);
  });

  it('accepts http only for loopback hosts (dev carve-out)', () => {
    expect(isCredentialSafeUrl('http://localhost:3000/api')).toBe(true);
    expect(isCredentialSafeUrl('http://127.0.0.1/api')).toBe(true);
    expect(isCredentialSafeUrl('http://[::1]:8080/api')).toBe(true);
  });

  it('rejects cleartext http to a real host', () => {
    expect(isCredentialSafeUrl('http://merchant.example/api')).toBe(false);
    expect(isCredentialSafeUrl('http://attacker.test/harvest')).toBe(false);
  });

  it('rejects non-http(s) schemes and unparseable URLs', () => {
    expect(isCredentialSafeUrl('ftp://merchant.example/api')).toBe(false);
    expect(isCredentialSafeUrl('file:///etc/passwd')).toBe(false);
    expect(isCredentialSafeUrl('not a url')).toBe(false);
    expect(isCredentialSafeUrl('')).toBe(false);
  });
});

describe('url-security: assertCredentialTarget', () => {
  it('passes for https / loopback http', () => {
    expect(() => assertCredentialTarget('https://merchant.example/api')).not.toThrow();
    expect(() => assertCredentialTarget('http://localhost:3000/api')).not.toThrow();
  });

  it('throws insecure_credential_transport for cleartext http to a real host', () => {
    expect(() => assertCredentialTarget('http://merchant.example/api')).toThrowError(
      expect.objectContaining({ code: 'insecure_credential_transport' }),
    );
  });

  it('surfaces the offending scheme + url in extra', () => {
    try {
      assertCredentialTarget('http://merchant.example/api');
      throw new Error('expected assertCredentialTarget to throw');
    } catch (err) {
      expect(err).toMatchObject({
        code: 'insecure_credential_transport',
        extra: { url: 'http://merchant.example/api', scheme: 'http:' },
        nextSteps: { action: 'use_https_endpoint' },
      });
    }
  });

  it('throws for an unparseable URL', () => {
    expect(() => assertCredentialTarget('::::nonsense')).toThrowError(
      expect.objectContaining({ code: 'insecure_credential_transport' }),
    );
  });
});

describe('url-security: createSecureFetch', () => {
  /** A fetch mock that records every URL it is asked to hit. */
  function recordingFetch(
    responder: (url: string, call: number) => Response,
  ): { fetch: typeof globalThis.fetch; calls: string[] } {
    const calls: string[] = [];
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      return responder(url, calls.length);
    }) as unknown as typeof globalThis.fetch;
    return { fetch, calls };
  }

  function redirectTo(location: string, status = 302): Response {
    return new Response(null, { status, headers: { location } });
  }

  it('forces redirect:manual on the underlying fetch', async () => {
    let seenRedirect: RequestRedirect | undefined;
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      seenRedirect = init?.redirect;
      return new Response('ok', { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const secure = createSecureFetch({ fetch });
    await secure('https://merchant.example/api', { method: 'POST' });
    expect(seenRedirect).toBe('manual');
  });

  it('passes a non-redirect response straight through', async () => {
    const { fetch, calls } = recordingFetch(() => new Response('{"ok":true}', { status: 200 }));
    const secure = createSecureFetch({ fetch });
    const res = await secure('https://merchant.example/api');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"ok":true}');
    expect(calls).toEqual(['https://merchant.example/api']);
  });

  it('REFUSES a 302 to a DIFFERENT host and never re-issues the request (no credential forwarding)', async () => {
    const { fetch, calls } = recordingFetch((_url, call) =>
      call === 1 ? redirectTo('http://attacker.test/harvest') : new Response('leaked', { status: 200 }),
    );
    const secure = createSecureFetch({ fetch });

    await expect(secure('https://merchant.example/api')).rejects.toMatchObject({
      code: 'credential_redirect_blocked',
      extra: { from: 'https://merchant.example/api', to: 'http://attacker.test/harvest' },
    });
    // Critically: the attacker URL was never fetched, so X-Operator-Token never left.
    expect(calls).toEqual(['https://merchant.example/api']);
  });

  it('REFUSES a cross-origin https redirect (different host, even if https)', async () => {
    const { fetch, calls } = recordingFetch((_url, call) =>
      call === 1 ? redirectTo('https://other.example/elsewhere') : new Response('ok', { status: 200 }),
    );
    const secure = createSecureFetch({ fetch });
    await expect(secure('https://merchant.example/api')).rejects.toMatchObject({
      code: 'credential_redirect_blocked',
    });
    expect(calls).toEqual(['https://merchant.example/api']);
  });

  it('REFUSES a same-host redirect that downgrades to http (cleartext)', async () => {
    const { fetch, calls } = recordingFetch((_url, call) =>
      call === 1 ? redirectTo('http://merchant.example/api') : new Response('ok', { status: 200 }),
    );
    const secure = createSecureFetch({ fetch });
    await expect(secure('https://merchant.example/api')).rejects.toMatchObject({
      code: 'credential_redirect_blocked',
    });
    expect(calls).toEqual(['https://merchant.example/api']);
  });

  it('FOLLOWS a same-origin https redirect (re-issuing to the new path) and returns the final response', async () => {
    const { fetch, calls } = recordingFetch((_url, call) =>
      call === 1
        ? redirectTo('https://merchant.example/api/v2')
        : new Response('{"settled":true}', { status: 200 }),
    );
    const secure = createSecureFetch({ fetch });
    const res = await secure('https://merchant.example/api');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"settled":true}');
    expect(calls).toEqual(['https://merchant.example/api', 'https://merchant.example/api/v2']);
  });

  it('resolves a relative Location against the current URL (same-origin) and follows it', async () => {
    const { fetch, calls } = recordingFetch((_url, call) =>
      call === 1 ? redirectTo('/api/final') : new Response('ok', { status: 200 }),
    );
    const secure = createSecureFetch({ fetch });
    const res = await secure('https://merchant.example/api');
    expect(res.status).toBe(200);
    expect(calls).toEqual(['https://merchant.example/api', 'https://merchant.example/api/final']);
  });

  it('hands back a 3xx with no Location header rather than looping', async () => {
    const { fetch, calls } = recordingFetch(() => new Response(null, { status: 302 }));
    const secure = createSecureFetch({ fetch });
    const res = await secure('https://merchant.example/api');
    expect(res.status).toBe(302);
    expect(calls).toEqual(['https://merchant.example/api']);
  });

  it('caps same-origin redirect hops to avoid an infinite loop (throws on the 4th hop)', async () => {
    // Always redirects to a fresh same-origin path → would loop forever without the cap.
    const { fetch, calls } = recordingFetch((_url, call) => redirectTo(`https://merchant.example/hop${call}`));
    const secure = createSecureFetch({ fetch });
    await expect(secure('https://merchant.example/api')).rejects.toMatchObject({
      code: 'credential_redirect_blocked',
    });
    // "more than 3" means exactly 3 hops were followed: the initial request + 3 redirects.
    expect(calls).toEqual([
      'https://merchant.example/api',
      'https://merchant.example/hop1',
      'https://merchant.example/hop2',
      'https://merchant.example/hop3',
    ]);
  });

  it('FOLLOWS exactly MAX_SAME_ORIGIN_REDIRECTS (3) same-origin hops before a final response', async () => {
    const { fetch, calls } = recordingFetch((_url, call) =>
      call <= 3 ? redirectTo(`https://merchant.example/hop${call}`) : new Response('ok', { status: 200 }),
    );
    const secure = createSecureFetch({ fetch });
    const res = await secure('https://merchant.example/api');
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(4); // initial + 3 followed redirects
  });

  it('accepts a URL object as input', async () => {
    const { fetch, calls } = recordingFetch(() => new Response('ok', { status: 200 }));
    const secure = createSecureFetch({ fetch });
    const res = await secure(new URL('https://merchant.example/api'));
    expect(res.status).toBe(200);
    expect(calls).toEqual(['https://merchant.example/api']);
  });

  it('accepts a Request object as input', async () => {
    const { fetch, calls } = recordingFetch(() => new Response('ok', { status: 200 }));
    const secure = createSecureFetch({ fetch });
    const res = await secure(new Request('https://merchant.example/api'));
    expect(res.status).toBe(200);
    expect(calls).toEqual(['https://merchant.example/api']);
  });

  it('REFUSES a redirect whose Location header is unparseable', async () => {
    // A garbage Location that cannot resolve even against the current base must
    // be refused, never silently followed.
    const { fetch } = recordingFetch((_url, call) =>
      call === 1
        ? new Response(null, { status: 302, headers: { location: 'http://[bad' } })
        : new Response('ok', { status: 200 }),
    );
    const secure = createSecureFetch({ fetch });
    await expect(secure('https://merchant.example/api')).rejects.toMatchObject({
      code: 'credential_redirect_blocked',
    });
  });
});
