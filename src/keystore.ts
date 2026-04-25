import { createCipheriv, createDecipheriv, randomBytes, scrypt, type ScryptOptions } from 'crypto';
import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { dirname } from 'path';
import {
  DEFAULT_WALLET_NAME,
  isValidWalletName,
  keystorePath as _keystorePath,
  legacyKeystorePath,
  walletsDir,
} from './paths';
import type { Chain } from './constants';

export { keystorePath } from './paths';

const KDF_N = 131072;
const KDF_R = 8;
const KDF_P = 1;
const KEY_LEN = 32;
const MAX_MEM = 256 * 1024 * 1024;

function scryptAsync(passphrase: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(passphrase, salt, keylen, opts, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export interface KeystoreFile {
  version: 1;
  chain: Chain;
  address: string;
  name?: string;
  encryption: {
    kdf: 'scrypt';
    kdfParams: { N: number; r: number; p: number; saltHex: string };
    cipher: 'aes-256-gcm';
    cipherIv: string;
    cipherAuthTag: string;
    ciphertext: string;
  };
}

export async function encryptSecret(
  secret: Buffer,
  passphrase: string,
): Promise<KeystoreFile['encryption']> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await scryptAsync(passphrase, salt, KEY_LEN, { N: KDF_N, r: KDF_R, p: KDF_P, maxmem: MAX_MEM });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(secret), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    kdf: 'scrypt',
    kdfParams: { N: KDF_N, r: KDF_R, p: KDF_P, saltHex: salt.toString('hex') },
    cipher: 'aes-256-gcm',
    cipherIv: iv.toString('hex'),
    cipherAuthTag: authTag.toString('hex'),
    ciphertext: ct.toString('hex'),
  };
}

export async function decryptSecret(
  enc: KeystoreFile['encryption'],
  passphrase: string,
): Promise<Buffer> {
  const salt = Buffer.from(enc.kdfParams.saltHex, 'hex');
  const iv = Buffer.from(enc.cipherIv, 'hex');
  const authTag = Buffer.from(enc.cipherAuthTag, 'hex');
  const ct = Buffer.from(enc.ciphertext, 'hex');
  const key = await scryptAsync(passphrase, salt, KEY_LEN, {
    N: enc.kdfParams.N,
    r: enc.kdfParams.r,
    p: enc.kdfParams.p,
    maxmem: MAX_MEM,
  });
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export async function saveKeystore(file: KeystoreFile): Promise<string> {
  const name = file.name ?? DEFAULT_WALLET_NAME;
  if (!isValidWalletName(name)) throw new Error(`Invalid wallet name: ${name}`);
  const path = _keystorePath(file.chain, name);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify({ ...file, name }, null, 2), { mode: 0o600 });
  return path;
}

async function readKeystoreFromPath(path: string, chain: Chain): Promise<KeystoreFile> {
  const raw = await readFile(path, 'utf-8');
  const parsed = JSON.parse(raw) as KeystoreFile;
  if (parsed.version !== 1) throw new Error(`Unsupported keystore version: ${parsed.version}`);
  if (parsed.chain !== chain) throw new Error(`Keystore chain mismatch: expected ${chain}, got ${parsed.chain}`);
  return parsed;
}

export async function loadKeystore(chain: Chain, name: string = DEFAULT_WALLET_NAME): Promise<KeystoreFile> {
  if (!isValidWalletName(name)) throw new Error(`Invalid wallet name: ${name}`);
  try {
    return await readKeystoreFromPath(_keystorePath(chain, name), chain);
  } catch (err) {
    if (name === DEFAULT_WALLET_NAME && isNotFound(err)) {
      return readKeystoreFromPath(legacyKeystorePath(chain), chain);
    }
    throw err;
  }
}

export async function keystoreExists(chain: Chain, name: string = DEFAULT_WALLET_NAME): Promise<boolean> {
  if (!isValidWalletName(name)) return false;
  try {
    await readFile(_keystorePath(chain, name), 'utf-8');
    return true;
  } catch {
    if (name === DEFAULT_WALLET_NAME) {
      try {
        await readFile(legacyKeystorePath(chain), 'utf-8');
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export async function listWallets(chain: Chain): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(walletsDir());
  } catch {
    return [];
  }
  const names = new Set<string>();
  const prefix = `${chain}-`;
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    if (entry === `${chain}.json`) {
      names.add(DEFAULT_WALLET_NAME);
      continue;
    }
    if (entry.startsWith(prefix)) {
      names.add(entry.slice(prefix.length, -'.json'.length));
    }
  }
  return [...names].sort();
}

function isNotFound(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT');
}
