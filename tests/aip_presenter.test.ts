/**
 * AIP presenter: mints the Agent Identity Token once, re-signs per request attempt, decodes
 * iss/sub for display, and carries an optional intent into the mint body.
 */
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAipPresenter } from '../src/aip/presenter';

let home: string;
const OPERATOR = `opc_${'a'.repeat(64)}`;
const PASS = 'test-passphrase-123';

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pay-aip-presenter-'));
  process.env.AGENTSCORE_PAY_HOME = home;
  process.env.AGENTSCORE_PAY_PASSPHRASE = PASS;
});
afterEach(async () => {
  delete process.env.AGENTSCORE_PAY_HOME;
  delete process.env.AGENTSCORE_PAY_PASSPHRASE;
  await rm(home, { recursive: true, force: true });
});

const b64url = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload: Record<string, unknown>): string =>
  `${b64url({ alg: 'EdDSA', typ: 'JWT' })}.${b64url(payload)}.sig`;

const mintFetch = (token: string, onBody?: (body: Record<string, unknown>) => void) =>
  vi.fn(async (_url: string, opts?: { body?: string }) => {
    if (onBody && opts?.body) onBody(JSON.parse(opts.body));
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ token, token_type: 'AIT', expires_in: 300 }),
    } as unknown as Response;
  });

describe('createAipPresenter', () => {
  it('mints once, decodes iss/sub, and signs the request with the three PoP headers', async () => {
    const token = jwt({ iss: 'https://www.agentscore.com', sub: 'as_op_test0001' });
    const fetchMock = mintFetch(token);
    const presenter = await createAipPresenter({ operatorToken: OPERATOR, passphrase: PASS, fetch: fetchMock });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(presenter.issuer).toBe('https://www.agentscore.com');
    expect(presenter.subject).toBe('as_op_test0001');
    expect(presenter.expiresIn).toBe(300);
    expect(['autonomous', 'human_present']).toContain(presenter.trustLevel);

    const h = presenter.sign({ method: 'POST', authority: 'wine.example', path: '/purchase' });
    expect(h['Agent-Identity']).toBe(token);
    expect(h['Signature-Input']).toContain('tag="agent-identity"');
    expect(h.Signature).toMatch(/^ait=:.+:$/);
  });

  it('re-signs per call WITHOUT re-minting (different request → different signature)', async () => {
    const fetchMock = mintFetch(jwt({ iss: 'x', sub: 'y' }));
    const presenter = await createAipPresenter({ operatorToken: OPERATOR, passphrase: PASS, fetch: fetchMock });

    const a = presenter.sign({ method: 'POST', authority: 'm.example', path: '/a' });
    const b = presenter.sign({ method: 'POST', authority: 'm.example', path: '/b' });

    expect(fetchMock).toHaveBeenCalledTimes(1); // minted once
    expect(a.Signature).not.toBe(b.Signature); // path is a covered component → distinct signature
  });

  it('carries --intent into the mint body as intent.description', async () => {
    let captured: Record<string, unknown> | undefined;
    const fetchMock = mintFetch(jwt({ iss: 'x', sub: 'y' }), (body) => (captured = body));
    await createAipPresenter({ operatorToken: OPERATOR, passphrase: PASS, intent: 'Buy a 2021 Pinot Noir', fetch: fetchMock });

    expect(captured?.intent).toEqual({ description: 'Buy a 2021 Pinot Noir' });
    expect(captured?.trust_level).toBeDefined();
  });

  it('omits intent when none is given', async () => {
    let captured: Record<string, unknown> | undefined;
    const fetchMock = mintFetch(jwt({ iss: 'x', sub: 'y' }), (body) => (captured = body));
    await createAipPresenter({ operatorToken: OPERATOR, passphrase: PASS, fetch: fetchMock });

    expect(captured).toBeDefined();
    expect('intent' in (captured as Record<string, unknown>)).toBe(false);
  });
});
