import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ROOT = '/tmp/pay-init-test';

async function setup() {
  await rm(ROOT, { recursive: true, force: true });
  await mkdir(join(ROOT, '.agentscore', 'wallets'), { recursive: true });
}

async function plantKeystore(chain: string) {
  await writeFile(
    join(ROOT, '.agentscore', 'wallets', `${chain}-default.json`),
    JSON.stringify({
      version: 1,
      chain,
      address: '0x' + 'a'.repeat(40),
      encryption: {
        kdf: 'scrypt',
        kdfParams: { N: 16384, r: 8, p: 1, saltHex: '00'.repeat(16) },
        cipher: 'aes-256-gcm',
        cipherIv: '00'.repeat(12),
        cipherAuthTag: '00'.repeat(16),
        ciphertext: '00'.repeat(32),
      },
    }),
  );
}

async function plantMnemonic() {
  await writeFile(
    join(ROOT, '.agentscore', 'mnemonic.json'),
    JSON.stringify({
      version: 1,
      created_at: new Date().toISOString(),
      chains: ['base', 'solana', 'tempo'],
      encryption: {
        kdf: 'scrypt',
        kdfParams: { N: 16384, r: 8, p: 1, saltHex: '00'.repeat(16) },
        cipher: 'aes-256-gcm',
        cipherIv: '00'.repeat(12),
        cipherAuthTag: '00'.repeat(16),
        ciphertext: '00'.repeat(32),
      },
    }),
  );
}

describe('init command', () => {
  let originalHome: string | undefined;
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    process.env.HOME = ROOT;
    process.env.AGENTSCORE_PAY_PASSPHRASE = 'integration-test-pass';
    await setup();
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.resetModules();
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    delete process.env.AGENTSCORE_PAY_PASSPHRASE;
    stdout.mockRestore();
    stderr.mockRestore();
    await rm(ROOT, { recursive: true, force: true });
  });

  function jsonOutput() {
    return JSON.parse(stdout.mock.calls.map((c) => String(c[0])).join('').trim());
  }

  it('reports already_initialized when all 3 keystores exist', async () => {
    for (const c of ['base', 'solana', 'tempo']) await plantKeystore(c);
    const { setMode } = await import('../src/output');
    setMode('json');
    const { init } = await import('../src/commands/init');
    await init({ mnemonic: false });
    const out = jsonOutput();
    expect(out.already_initialized).toBe(true);
    expect(out.existing_wallets).toEqual(['base', 'solana', 'tempo']);
  });

  it('refuses --no-mnemonic when mnemonic exists and chains are missing', async () => {
    await plantMnemonic();
    await plantKeystore('base'); // only base exists
    const { setMode } = await import('../src/output');
    setMode('json');
    const { init } = await import('../src/commands/init');
    await expect(init({ mnemonic: false })).rejects.toMatchObject({
      code: 'wallet_exists',
      nextSteps: { action: 'recover_from_mnemonic_or_clear' },
    });
  });

  it('refuses --mnemonic when mnemonic.json already exists', async () => {
    await plantMnemonic();
    const { setMode } = await import('../src/output');
    setMode('json');
    const { init } = await import('../src/commands/init');
    await expect(init({ mnemonic: true })).rejects.toMatchObject({
      code: 'wallet_exists',
      nextSteps: { action: 'inspect_or_remove_mnemonic' },
    });
  });
});
