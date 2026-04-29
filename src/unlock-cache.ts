import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { CliError } from './errors';
import { baseDir } from './paths';

interface UnlockCache {
  passphrase: string;
  expires_at: string;
}

const MAX_TTL_MS = 8 * 60 * 60 * 1000;

export function unlockCachePath(): string {
  return join(baseDir(), '.unlock');
}

export async function readCachedPassphrase(): Promise<string | null> {
  try {
    const raw = await readFile(unlockCachePath(), 'utf-8');
    const cache = JSON.parse(raw) as UnlockCache;
    const expires = Date.parse(cache.expires_at);
    if (!Number.isFinite(expires) || Date.now() > expires) {
      await clearCache();
      return null;
    }
    return cache.passphrase;
  } catch {
    return null;
  }
}

export async function writeCachedPassphrase(passphrase: string, ttlMs: number): Promise<string> {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new CliError('invalid_input', 'unlock duration must be positive');
  }
  const clamped = Math.min(ttlMs, MAX_TTL_MS);
  const path = unlockCachePath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const expires = new Date(Date.now() + clamped).toISOString();
  const cache: UnlockCache = { passphrase, expires_at: expires };
  await writeFile(path, JSON.stringify(cache), { mode: 0o600 });
  return expires;
}

export async function clearCache(): Promise<boolean> {
  try {
    await rm(unlockCachePath());
    return true;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT') return false;
    throw err;
  }
}

const DURATION_PATTERN = /^(\d+)([smhd])$/;

export function parseDuration(input: string): number {
  const m = DURATION_PATTERN.exec(input.trim());
  if (!m) {
    throw new CliError('invalid_input', `Invalid duration "${input}" — use e.g. 15m, 2h, 30s, 1d.`);
  }
  const n = Number(m[1]);
  const unit = m[2];
  switch (unit) {
    case 's': return n * 1000;
    case 'm': return n * 60 * 1000;
    case 'h': return n * 60 * 60 * 1000;
    case 'd': return n * 24 * 60 * 60 * 1000;
    default: throw new CliError('invalid_input', `Unknown duration unit: ${unit}`);
  }
}
