/**
 * Mint client + present flow: mocked issuer fetch → mint → RFC 9421 headers; trust_level
 * inference; error mapping.
 */
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { AgentScoreError } from '@agent-score/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inferTrustLevel, mintAit } from '../src/aip/mint';
import { presentAit } from '../src/aip/present';

interface MintBody {
  operator_token?: string;
  cnf_jwk?: { kty?: string; crv?: string; x?: string };
  trust_level?: string;
  agent?: { provider?: string };
  auth?: { amr?: string[]; time?: number };
  intent?: { description?: string; actions?: string[] };
}

let home: string;
const PASS = 'test-passphrase-123';
const OPERATOR = `opc_${'a'.repeat(64)}`;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pay-aip-mint-'));
  process.env.AGENTSCORE_PAY_HOME = home;
});
afterEach(async () => {
  delete process.env.AGENTSCORE_PAY_HOME;
  await rm(home, { recursive: true, force: true });
});

const okFetch = (captured?: { body?: unknown; headers?: Record<string, string> }) =>
  vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    if (captured) {
      captured.body = init?.body ? JSON.parse(init.body as string) : undefined;
      captured.headers = (init?.headers as Record<string, string>) ?? {};
    }
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ token: 'header.payload.sig', token_type: 'AIT', expires_in: 300 }),
    } as unknown as Response;
  });

describe('mintAit', () => {
  it('posts cnf + operator_token + trust_level with the pay client id, returns the token', async () => {
    const cap: { body?: MintBody; headers?: Record<string, string> } = {};
    const r = await mintAit({
      operatorToken: OPERATOR,
      cnfJwk: { kty: 'OKP', crv: 'Ed25519', x: 'abc' },
      provider: 'anthropic',
      trustLevel: 'human_present',
      fetch: okFetch(cap),
    });
    expect(r.token).toBe('header.payload.sig');
    expect(r.expiresIn).toBe(300);
    expect(cap.headers?.['X-Client-Id']).toBe('agentscore_pay_pubclient_v1');
    expect(cap.body?.operator_token).toBe(OPERATOR);
    expect(cap.body?.cnf_jwk).toEqual({ kty: 'OKP', crv: 'Ed25519', x: 'abc' });
    expect(cap.body?.trust_level).toBe('human_present');
    expect(cap.body?.agent?.provider).toBe('anthropic');
  });

  it('sends human_confirmed with auth.amr + intent (description + actions)', async () => {
    const cap: { body?: MintBody } = {};
    await mintAit({
      operatorToken: OPERATOR,
      cnfJwk: { kty: 'OKP', crv: 'Ed25519', x: 'abc' },
      provider: 'anthropic',
      trustLevel: 'human_confirmed',
      intent: 'Buy a 2021 Pinot Noir',
      actions: ['purchase'],
      auth: { amr: ['user'] },
      fetch: okFetch(cap),
    });
    expect(cap.body?.trust_level).toBe('human_confirmed');
    expect(cap.body?.auth).toEqual({ amr: ['user'] });
    expect(cap.body?.intent).toEqual({ description: 'Buy a 2021 Pinot Noir', actions: ['purchase'] });
  });

  it('sends intent.actions without a description (the action-only, non-confirmed case)', async () => {
    const cap: { body?: MintBody } = {};
    await mintAit({
      operatorToken: OPERATOR,
      cnfJwk: { kty: 'OKP', crv: 'Ed25519', x: 'abc' },
      provider: 'p',
      trustLevel: 'human_present',
      actions: ['purchase'],
      fetch: okFetch(cap),
    });
    expect(cap.body?.intent).toEqual({ actions: ['purchase'] });
    expect(cap.body?.auth).toBeUndefined();
  });

  it('omits intent + auth entirely when none are set', async () => {
    const cap: { body?: MintBody } = {};
    await mintAit({
      operatorToken: OPERATOR,
      cnfJwk: { kty: 'OKP', crv: 'Ed25519', x: 'abc' },
      provider: 'p',
      trustLevel: 'autonomous',
      fetch: okFetch(cap),
    });
    expect(cap.body?.intent).toBeUndefined();
    expect(cap.body?.auth).toBeUndefined();
  });

  it('maps an error response to AgentScoreError with the issuer code', async () => {
    const errFetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ error: { code: 'unregistered_client_id', message: 'nope' } }),
    }) as unknown as Response);
    await expect(
      mintAit({ operatorToken: OPERATOR, cnfJwk: { kty: 'OKP', crv: 'Ed25519', x: 'a' }, provider: 'p', trustLevel: 'autonomous', fetch: errFetch }),
    ).rejects.toMatchObject({ code: 'unregistered_client_id' });
  });

  it('falls back to http_error when an error body is not JSON', async () => {
    const errFetch = vi.fn(async () => ({ ok: false, status: 502, text: async () => '<html>bad gateway' }) as unknown as Response);
    await expect(
      mintAit({ operatorToken: OPERATOR, cnfJwk: { kty: 'OKP', crv: 'Ed25519', x: 'a' }, provider: 'p', trustLevel: 'autonomous', fetch: errFetch }),
    ).rejects.toMatchObject({ code: 'http_error', status: 502 });
  });

  it('rejects a non-JSON success body as invalid_response', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 201, text: async () => 'not json' }) as unknown as Response);
    await expect(
      mintAit({ operatorToken: OPERATOR, cnfJwk: { kty: 'OKP', crv: 'Ed25519', x: 'a' }, provider: 'p', trustLevel: 'autonomous', fetch: f }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('rejects a success body missing the token as invalid_response', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 201, text: async () => JSON.stringify({ token_type: 'AIT', expires_in: 300 }) }) as unknown as Response);
    await expect(
      mintAit({ operatorToken: OPERATOR, cnfJwk: { kty: 'OKP', crv: 'Ed25519', x: 'a' }, provider: 'p', trustLevel: 'autonomous', fetch: f }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('rejects an empty-string token as invalid_response', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 201, text: async () => JSON.stringify({ token: '', expires_in: 300 }) }) as unknown as Response);
    await expect(
      mintAit({ operatorToken: OPERATOR, cnfJwk: { kty: 'OKP', crv: 'Ed25519', x: 'a' }, provider: 'p', trustLevel: 'autonomous', fetch: f }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('REFUSES a redirect off the issuer origin — the operator_token body is never re-sent', async () => {
    // undici re-issues request bodies on cross-origin 307/308; the mint body carries the bearer
    // operator_token, so the redirect must abort instead of forwarding it to the foreign origin.
    const f = vi.fn(async () =>
      new Response(null, { status: 307, headers: { location: 'https://attacker.example/v1/agent-identity/token' } }),
    ) as unknown as typeof globalThis.fetch;
    await expect(
      mintAit({ operatorToken: OPERATOR, cnfJwk: { kty: 'OKP', crv: 'Ed25519', x: 'a' }, provider: 'p', trustLevel: 'autonomous', fetch: f }),
    ).rejects.toMatchObject({ code: 'credential_redirect_blocked' });
    expect(f).toHaveBeenCalledTimes(1); // the foreign origin was never fetched
  });

  it('falls back to an absolute default URL when baseUrl is empty (no relative request)', async () => {
    const cap: { url?: string } = {};
    const f = vi.fn(async (url: string | URL | Request) => {
      cap.url = String(url);
      return { ok: true, status: 201, text: async () => JSON.stringify({ token: 'a.b.c', expires_in: 300 }) } as unknown as Response;
    });
    await mintAit({ operatorToken: OPERATOR, cnfJwk: { kty: 'OKP', crv: 'Ed25519', x: 'a' }, provider: 'p', trustLevel: 'autonomous', baseUrl: '', fetch: f });
    expect(cap.url?.startsWith('http')).toBe(true);
    expect(cap.url).toContain('/v1/agent-identity/token');
  });
});

describe('inferTrustLevel', () => {
  const origIn = process.stdin.isTTY;
  const origOut = process.stdout.isTTY;
  afterEach(() => {
    process.stdin.isTTY = origIn;
    process.stdout.isTTY = origOut;
  });

  it('is human_present when both stdin and stdout are a TTY', () => {
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
    expect(inferTrustLevel()).toBe('human_present');
  });

  it('is autonomous when not a TTY (piped / CI / headless)', () => {
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;
    expect(inferTrustLevel()).toBe('autonomous');
  });
});

describe('presentAit', () => {
  it('mints + signs, returning the three presentation headers', async () => {
    const cap: { body?: MintBody } = {};
    const presented = await presentAit({
      operatorToken: OPERATOR,
      passphrase: PASS,
      request: { method: 'POST', authority: 'wine.example', path: '/purchase' },
      trustLevel: 'autonomous',
      fetch: okFetch(cap),
    });
    expect(presented.headers['Agent-Identity']).toBe('header.payload.sig');
    expect(presented.headers['Signature-Input']).toMatch(/^ait=\("@method" "@authority" "@path" "agent-identity"\);created=\d+;expires=\d+;keyid="[^"]+";tag="agent-identity"$/);
    expect(presented.headers.Signature).toMatch(/^ait=:[A-Za-z0-9+/]+=*:$/);
    expect(presented.trustLevel).toBe('autonomous');
    // The cnf sent to the issuer is the same key whose thumbprint is the signature keyid.
    expect(cap.body?.cnf_jwk?.kty).toBe('OKP');
    expect(AgentScoreError).toBeDefined();
  });
});
