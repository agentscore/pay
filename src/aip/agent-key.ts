/**
 * AIP agent key — the Ed25519 keypair pay uses as the AIT `cnf` (proof-of-possession) key.
 *
 * One Ed25519 key, independent of payment wallets (which are chain-typed secp256k1/ed25519). The
 * public half is bound into a minted AIT's `cnf` claim; the private half signs each merchant
 * request (RFC 9421) to prove possession. Stored encrypted at {@link agentKeyPath} with the same
 * AES-256-GCM + scrypt envelope as the wallet keystore.
 *
 * Only the private scalar (`d`) is persisted (encrypted). The public JWK + keyid thumbprint are
 * derived on load and are safe to display/transmit.
 */
import { createPrivateKey, generateKeyPairSync, type KeyObject } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { CliError } from '../errors';
import { encryptSecret, decryptSecret, type KeystoreFile } from '../keystore';
import { agentKeyPath, baseDir } from '../paths';
import type { Ed25519PublicJwk } from './http-signature';

interface AgentKeyFile {
  version: 1;
  kind: 'aip-agent-key';
  crv: 'Ed25519';
  /** Public x coordinate (base64url) — kept in the clear for quick public-JWK reads. */
  x: string;
  /** Encrypted private scalar `d` (the 32-byte Ed25519 seed). */
  encryption: KeystoreFile['encryption'];
}

export interface AgentKey {
  /** node:crypto private KeyObject for signing. */
  privateKey: KeyObject;
  /** Public cnf JWK to embed in the AIT mint request. */
  publicJwk: Ed25519PublicJwk;
}

const isNotFound = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';

/** True if an agent key already exists on disk. Only ENOENT means "missing" — any other
 *  error (EACCES, EIO, ...) propagates so a transient failure never silently regenerates
 *  (and overwrites) the key. */
export async function agentKeyExists(): Promise<boolean> {
  try {
    await readFile(agentKeyPath(), 'utf-8');
    return true;
  } catch (err: unknown) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

async function loadAgentKey(passphrase: string): Promise<AgentKey> {
  const raw = await readFile(agentKeyPath(), 'utf-8');
  const file = JSON.parse(raw) as AgentKeyFile;
  if (file.version !== 1 || file.kind !== 'aip-agent-key') {
    throw new Error('Unsupported AIP agent-key file');
  }
  let d: string;
  try {
    d = (await decryptSecret(file.encryption, passphrase)).toString('base64url');
  } catch {
    throw new CliError(
      'wrong_passphrase',
      `Could not decrypt the AIP agent key at ${agentKeyPath()} — the passphrase does not match the one the key was created with.`,
      {
        nextSteps: {
          action: 'retry_or_regenerate_agent_key',
          suggestion: `Retry with the passphrase the agent key was created under, or delete ${agentKeyPath()} to regenerate it — the cnf public key is re-sent on every mint, so deleting it is safe.`,
        },
        extra: { path: agentKeyPath() },
      },
    );
  }
  const privateKey = createPrivateKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: file.x, d },
    format: 'jwk',
  });
  return { privateKey, publicJwk: { kty: 'OKP', crv: 'Ed25519', x: file.x } };
}

async function createAgentKey(passphrase: string): Promise<AgentKey> {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privJwk = privateKey.export({ format: 'jwk' }) as { x: string; d: string };
  const seed = Buffer.from(privJwk.d, 'base64url');
  const encryption = await encryptSecret(seed, passphrase);
  const file: AgentKeyFile = {
    version: 1,
    kind: 'aip-agent-key',
    crv: 'Ed25519',
    x: privJwk.x,
    encryption,
  };
  const path = agentKeyPath();
  await mkdir(baseDir(), { recursive: true, mode: 0o700 });
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    // Exclusive create: never clobber a key another process persisted between the exists
    // check and this write — losing the create race means the other key is canonical.
    await writeFile(path, JSON.stringify(file, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  } catch (err: unknown) {
    if ((err as { code?: string } | null)?.code === 'EEXIST') return loadAgentKey(passphrase);
    throw err;
  }
  void publicKey; // public material is derived from the stored JWK on load
  return { privateKey, publicJwk: { kty: 'OKP', crv: 'Ed25519', x: privJwk.x } };
}

/**
 * Load the agent key, creating + persisting one on first use. `passphrase` unlocks (or encrypts,
 * on first create) the private scalar — same passphrase model as the wallet keystore.
 */
export async function getOrCreateAgentKey(passphrase: string): Promise<AgentKey> {
  try {
    if (await agentKeyExists()) return await loadAgentKey(passphrase);
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  return createAgentKey(passphrase);
}
