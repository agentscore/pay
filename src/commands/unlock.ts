import { promptPassphrase } from '../prompts';
import { clearCache, parseDuration, unlockCachePath, writeCachedPassphrase } from '../unlock-cache';

export interface UnlockInput {
  forDuration?: string;
  clear?: boolean;
}

export interface UnlockResult {
  ok: true;
  cleared?: boolean;
  expires_at?: string;
  ttl_ms?: number;
  path: string;
}

export async function unlock(input: UnlockInput = {}): Promise<UnlockResult> {
  if (input.clear) {
    const removed = await clearCache();
    return { ok: true, cleared: removed, path: unlockCachePath() };
  }

  const duration = input.forDuration ?? '15m';
  const ttlMs = parseDuration(duration);
  const passphrase = await promptPassphrase('Passphrase to cache');
  const expiresAt = await writeCachedPassphrase(passphrase, ttlMs);
  return { ok: true, expires_at: expiresAt, ttl_ms: ttlMs, path: unlockCachePath() };
}
