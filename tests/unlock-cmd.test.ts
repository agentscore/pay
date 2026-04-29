import { mkdir, rm, stat } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = '/tmp/pay-unlock-cmd-test';

describe('unlock command', () => {
  let originalHome: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    process.env.HOME = ROOT;
    process.env.AGENTSCORE_PAY_PASSPHRASE = 'integration-test-pass';
    await rm(ROOT, { recursive: true, force: true });
    await mkdir(join(ROOT, '.agentscore'), { recursive: true });
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    delete process.env.AGENTSCORE_PAY_PASSPHRASE;
    await rm(ROOT, { recursive: true, force: true });
  });

  it('writes the cache file with mode 0600 and a future expiry', async () => {
    const { unlock } = await import('../src/commands/unlock');
    const result = await unlock({ forDuration: '5m' });
    expect(result.ok).toBe(true);
    expect(result.ttl_ms).toBe(5 * 60 * 1000);
    expect(Date.parse(result.expires_at!)).toBeGreaterThan(Date.now());
    const st = await stat(result.path);
    expect(st.mode & 0o777).toBe(0o600);
  });

  it('clamps an absurd duration to the 8h max', async () => {
    const { unlock } = await import('../src/commands/unlock');
    const result = await unlock({ forDuration: '99h' });
    const ms = Date.parse(result.expires_at!) - Date.now();
    expect(ms).toBeLessThanOrEqual(8 * 60 * 60 * 1000 + 1000);
  });

  it('--clear is a no-op when no cache exists', async () => {
    const { unlock } = await import('../src/commands/unlock');
    const result = await unlock({ clear: true });
    expect(result).toMatchObject({ ok: true, cleared: false });
  });

  it('--clear removes the cache file after a prior unlock', async () => {
    const { unlock } = await import('../src/commands/unlock');
    await unlock({ forDuration: '1m' });
    const result = await unlock({ clear: true });
    expect(result.cleared).toBe(true);
  });

  it('rejects malformed durations', async () => {
    const { unlock } = await import('../src/commands/unlock');
    await expect(unlock({ forDuration: '15' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(unlock({ forDuration: 'abc' })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
