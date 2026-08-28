import { rm } from 'fs/promises';
import { join } from 'path';
import { baseDir } from './paths';

/**
 * Removal of the plaintext passphrase cache.
 *
 * `~/.agentscore/.unlock` used to hold the wallet passphrase in cleartext for up
 * to 8 hours, beside the scrypt+AES keystores it unlocks. File modes (0600 in a
 * 0700 dir) were the only thing protecting it, which does nothing against
 * anything already running as that user: malware, a backup, a CI cache, or an
 * LLM agent with filesystem tools.
 *
 * The write path and the read path are both gone. What is left is the purge,
 * for two reasons: `wallet remove` still wants to wipe any cached secret when it
 * deletes a keystore, and an installation that HAS an `.unlock` from an older
 * version needs it deleted rather than orphaned. Leaving the file readable but
 * ignored would be the worst outcome, since the secret would still be on disk
 * with nothing left that admits to using it.
 *
 * Unattended use is `AGENTSCORE_PAY_PASSPHRASE` in the environment, which the
 * CLI already recommended over this cache and which leaves no on-disk artifact.
 */

function unlockCachePath(): string {
  return join(baseDir(), '.unlock');
}

/** Delete the cache if present. Returns whether a file was actually removed. */
export async function clearCache(): Promise<boolean> {
  try {
    await rm(unlockCachePath());
    return true;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT') { return false; }
    return false;
  }
}
