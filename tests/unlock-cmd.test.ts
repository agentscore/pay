import { mkdir, rm, stat } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ROOT = '/tmp/pay-unlock-cmd-test';

describe('unlock command', () => {
  let originalHome: string | undefined;
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    process.env.HOME = ROOT;
    process.env.AGENTSCORE_PAY_PASSPHRASE = 'integration-test-pass';
    await rm(ROOT, { recursive: true, force: true });
    await mkdir(join(ROOT, '.agentscore'), { recursive: true });
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.resetModules();
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    delete process.env.AGENTSCORE_PAY_PASSPHRASE;
    stdout.mockRestore();
    await rm(ROOT, { recursive: true, force: true });
  });

  function jsonOutput() {
    return JSON.parse(stdout.mock.calls.map((c) => String(c[0])).join('').trim());
  }

  it('writes the cache file with mode 0600 and a future expiry', async () => {
    const { setMode } = await import('../src/output');
    setMode('json');
    const { unlock } = await import('../src/commands/unlock');
    await unlock({ forDuration: '5m' });
    const out = jsonOutput();
    expect(out.ok).toBe(true);
    expect(out.ttl_ms).toBe(5 * 60 * 1000);
    expect(Date.parse(out.expires_at)).toBeGreaterThan(Date.now());
    const st = await stat(out.path);
    expect(st.mode & 0o777).toBe(0o600);
  });

  it('clamps an absurd duration to the 8h max', async () => {
    const { setMode } = await import('../src/output');
    setMode('json');
    const { unlock } = await import('../src/commands/unlock');
    await unlock({ forDuration: '99h' });
    const out = jsonOutput();
    const ms = Date.parse(out.expires_at) - Date.now();
    expect(ms).toBeLessThanOrEqual(8 * 60 * 60 * 1000 + 1000);
  });

  it('--clear is a no-op when no cache exists', async () => {
    const { setMode } = await import('../src/output');
    setMode('json');
    const { unlock } = await import('../src/commands/unlock');
    await unlock({ clear: true });
    const out = jsonOutput();
    expect(out).toMatchObject({ ok: true, cleared: false });
  });

  it('--clear removes the cache file after a prior unlock', async () => {
    const { setMode } = await import('../src/output');
    setMode('json');
    const { unlock } = await import('../src/commands/unlock');
    await unlock({ forDuration: '1m' });
    stdout.mockClear();
    await unlock({ clear: true });
    const out = jsonOutput();
    expect(out.cleared).toBe(true);
  });

  it('rejects malformed durations', async () => {
    const { setMode } = await import('../src/output');
    setMode('json');
    const { unlock } = await import('../src/commands/unlock');
    await expect(unlock({ forDuration: '15' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(unlock({ forDuration: 'abc' })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
