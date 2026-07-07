/**
 * Agent-key store: generate → persist (encrypted) → reload reproduces the same Ed25519 key, and
 * the loaded key signs identically to the freshly-generated one.
 */
import { sign as nodeSign } from 'crypto';
import { mkdir, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentKeyExists, getOrCreateAgentKey } from '../src/aip/agent-key';
import { jwkThumbprint } from '../src/aip/http-signature';

let home: string;
const PASS = 'test-passphrase-123';

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pay-aip-'));
  process.env.AGENTSCORE_PAY_HOME = home;
});
afterEach(async () => {
  delete process.env.AGENTSCORE_PAY_HOME;
  await rm(home, { recursive: true, force: true });
});

describe('agent-key', () => {
  it('creates on first use and reloads the same key', async () => {
    expect(await agentKeyExists()).toBe(false);
    const a = await getOrCreateAgentKey(PASS);
    expect(await agentKeyExists()).toBe(true);
    expect(a.publicJwk.kty).toBe('OKP');
    expect(a.publicJwk.crv).toBe('Ed25519');
    expect(a.publicJwk.x).toMatch(/^[A-Za-z0-9_-]+$/); // base64url

    const b = await getOrCreateAgentKey(PASS);
    expect(b.publicJwk.x).toBe(a.publicJwk.x);
    expect(jwkThumbprint(b.publicJwk)).toBe(jwkThumbprint(a.publicJwk));

    // The reloaded private key signs identically to the original.
    const msg = Buffer.from('proof-of-possession base');
    const s1 = nodeSign(null, msg, a.privateKey);
    const s2 = nodeSign(null, msg, b.privateKey);
    expect(s2.equals(s1)).toBe(true);
  });

  it('surfaces an actionable wrong_passphrase error (not a raw AES-GCM failure) on a passphrase mismatch', async () => {
    await getOrCreateAgentKey(PASS);
    await expect(getOrCreateAgentKey('wrong-passphrase-xyz')).rejects.toMatchObject({
      code: 'wrong_passphrase',
      message: expect.stringContaining('aip-agent-key.json'),
      nextSteps: {
        action: 'retry_or_regenerate_agent_key',
        suggestion: expect.stringContaining('delete'),
      },
    });
    // The mismatch must NOT regenerate the key — the original passphrase still unlocks it.
    await expect(getOrCreateAgentKey(PASS)).resolves.toBeDefined();
  });

  it('agentKeyExists propagates non-ENOENT errors instead of reporting "missing"', async () => {
    // A directory at the key path makes readFile fail with EISDIR — a transient/abnormal
    // error must surface, never silently regenerate (and overwrite) the key.
    await mkdir(join(home, 'aip-agent-key.json'));
    await expect(agentKeyExists()).rejects.toMatchObject({ code: 'EISDIR' });
    await expect(getOrCreateAgentKey(PASS)).rejects.toMatchObject({ code: 'EISDIR' });
  });

  it('a lost create race falls back to the persisted key instead of overwriting it', async () => {
    // Both racers scrypt before either writes; the exclusive `wx` create makes the loser
    // read the winner's key, so both resolve to the SAME persisted key.
    const [a, b] = await Promise.all([getOrCreateAgentKey(PASS), getOrCreateAgentKey(PASS)]);
    expect(b.publicJwk.x).toBe(a.publicJwk.x);
    const reloaded = await getOrCreateAgentKey(PASS);
    expect(reloaded.publicJwk.x).toBe(a.publicJwk.x);
  });
});
