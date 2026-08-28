import { existsSync } from 'fs';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * The plaintext passphrase cache is gone. `~/.agentscore/.unlock` used to hold
 * the wallet passphrase in cleartext for up to 8 hours beside the keystores it
 * unlocks, protected only by file modes, which stop nothing already running as
 * that user.
 *
 * These pin the two properties that matter after the removal. The passphrase is
 * never read back from disk, and a leftover file from an older version is
 * DELETED rather than ignored: an ignored file would leave a cleartext secret
 * sitting there with nothing left that admits to using it, which is worse than
 * either extreme.
 */

const ROOT = '/tmp/pay-unlock-removal-test';
const CACHE = join(ROOT, '.agentscore', '.unlock');

describe('plaintext passphrase cache removal', () => {
  let originalHome: string | undefined;
  let originalPass: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    originalPass = process.env.AGENTSCORE_PAY_PASSPHRASE;
    process.env.HOME = ROOT;
    delete process.env.AGENTSCORE_PAY_PASSPHRASE;
    await rm(ROOT, { force: true, recursive: true });
    await mkdir(join(ROOT, '.agentscore'), { recursive: true });
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    if (originalPass === undefined) { delete process.env.AGENTSCORE_PAY_PASSPHRASE; }
    else { process.env.AGENTSCORE_PAY_PASSPHRASE = originalPass; }
    await rm(ROOT, { force: true, recursive: true });
  });

  it('no longer exposes a way to read or write the cache', async () => {
    const mod = await import('../src/unlock-cache');
    // The whole point: nothing can put a passphrase on disk or take one off it.
    expect(mod).not.toHaveProperty('readCachedPassphrase');
    expect(mod).not.toHaveProperty('writeCachedPassphrase');
    // Positive control, so this does not pass by importing the wrong module.
    expect(mod).toHaveProperty('clearCache');
  });

  it('DELETES a leftover cache rather than reading it', async () => {
    await writeFile(CACHE, JSON.stringify({
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      passphrase: 'left-over-secret',
    }), { mode: 0o600 });
    expect(existsSync(CACHE), 'fixture did not land; the path is wrong').toBe(true);

    const { promptPassphrase } = await import('../src/prompts');
    // No TTY and no env var, so this rejects. What matters is the side effect.
    await expect(promptPassphrase()).rejects.toThrow();
    expect(existsSync(CACHE), 'a leftover plaintext passphrase was left on disk').toBe(false);
  });

  it('never returns the cached value even while the file exists', async () => {
    await writeFile(CACHE, JSON.stringify({
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      passphrase: 'left-over-secret',
    }), { mode: 0o600 });

    const { promptPassphrase } = await import('../src/prompts');
    await expect(promptPassphrase()).rejects.toThrow(/AGENTSCORE_PAY_PASSPHRASE/);
  });

  it('still prefers the environment variable, which is the supported path', async () => {
    process.env.AGENTSCORE_PAY_PASSPHRASE = 'from-env';
    const { promptPassphrase } = await import('../src/prompts');
    await expect(promptPassphrase()).resolves.toBe('from-env');
  });

  it('clearCache reports whether it removed anything', async () => {
    const { clearCache } = await import('../src/unlock-cache');
    expect(await clearCache(), 'nothing to remove should report false').toBe(false);
    await writeFile(CACHE, '{}', { mode: 0o600 });
    expect(await clearCache(), 'an existing file should report true').toBe(true);
  });
});
