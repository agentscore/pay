import { bold, dim, green, yellow } from '../colors';
import { isJson, writeJson, writeLine } from '../output';
import { promptPassphrase } from '../prompts';
import { clearCache, parseDuration, unlockCachePath, writeCachedPassphrase } from '../unlock-cache';

export interface UnlockOptions {
  forDuration?: string;
  clear?: boolean;
}

export async function unlock(opts: UnlockOptions = {}): Promise<void> {
  if (opts.clear) {
    const removed = await clearCache();
    if (isJson()) {
      writeJson({ ok: true, cleared: removed, path: unlockCachePath() });
      return;
    }
    writeLine(removed ? `${green('✓')} Unlock cache cleared.` : dim('No cached passphrase to clear.'));
    return;
  }

  const duration = opts.forDuration ?? '15m';
  const ttlMs = parseDuration(duration);
  const passphrase = await promptPassphrase('Passphrase to cache');
  const expiresAt = await writeCachedPassphrase(passphrase, ttlMs);

  if (isJson()) {
    writeJson({ ok: true, expires_at: expiresAt, path: unlockCachePath(), ttl_ms: ttlMs });
    return;
  }
  writeLine(`${green('✓')} Cached passphrase until ${bold(expiresAt)}`);
  writeLine(dim(`  (${unlockCachePath()}, mode 0600)`));
  writeLine(yellow('  Threat model: anyone with shell access as your user can read this file.'));
  writeLine(yellow('  Equivalent to AGENTSCORE_PAY_PASSPHRASE in the environment — convenience, not a security boundary.'));
}
