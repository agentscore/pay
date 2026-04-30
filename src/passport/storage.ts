import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { baseDir, passportPath } from '../paths';

/**
 * On-disk Passport at `~/.agentscore/passport.json` (mode 0600). Treat the
 * file like an SSH key: don't commit, restrict perms, rotate on compromise.
 */

export const PASSPORT_VERSION = 1;

export interface PassportVerifiedFacts {
  kyc?: boolean;
  age_bracket?: string;
  jurisdiction?: string;
  sanctions_clear?: boolean;
}

export interface Passport {
  version: number;
  operator_token: string;
  operator_id?: string;
  email?: string;
  verified_facts?: PassportVerifiedFacts;
  /** Absolute epoch-ms when operator_token expires. */
  expires_at: number;
  /** When this Passport was minted/refreshed (epoch-ms). */
  saved_at: number;
  refresh_token?: string;
  refresh_expires_at?: number;
}

export async function loadPassport(): Promise<Passport | null> {
  try {
    const raw = await readFile(passportPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.operator_token !== 'string' || typeof parsed.expires_at !== 'number') {
      return null;
    }
    return {
      version: typeof parsed.version === 'number' ? parsed.version : PASSPORT_VERSION,
      operator_token: parsed.operator_token,
      operator_id: typeof parsed.operator_id === 'string' ? parsed.operator_id : undefined,
      email: typeof parsed.email === 'string' ? parsed.email : undefined,
      verified_facts: parsed.verified_facts as PassportVerifiedFacts | undefined,
      expires_at: parsed.expires_at,
      saved_at: typeof parsed.saved_at === 'number' ? parsed.saved_at : Date.now(),
      refresh_token: typeof parsed.refresh_token === 'string' ? parsed.refresh_token : undefined,
      refresh_expires_at: typeof parsed.refresh_expires_at === 'number' ? parsed.refresh_expires_at : undefined,
    };
  } catch (err: unknown) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function savePassport(p: Passport): Promise<void> {
  const path = passportPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await mkdir(baseDir(), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(p, null, 2) + '\n', { mode: 0o600 });
}

export async function clearPassport(): Promise<boolean> {
  try {
    await rm(passportPath());
    return true;
  } catch (err: unknown) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

export function isExpired(p: Passport, now: number = Date.now()): boolean {
  return p.expires_at <= now;
}

export function expiresInDays(p: Passport, now: number = Date.now()): number {
  return Math.max(0, Math.floor((p.expires_at - now) / (24 * 60 * 60 * 1000)));
}

function isNotFound(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT');
}
