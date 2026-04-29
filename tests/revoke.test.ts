import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = '/tmp/pay-revoke-test';

async function setup() {
  await rm(ROOT, { recursive: true, force: true });
  await mkdir(join(ROOT, '.agentscore', 'wallets'), { recursive: true });
}

async function plantBaseKeystore() {
  await writeFile(
    join(ROOT, '.agentscore', 'wallets', 'base-default.json'),
    JSON.stringify({
      version: 1,
      chain: 'base',
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

describe('revoke command', () => {
  let originalHome: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    process.env.HOME = ROOT;
    process.env.AGENTSCORE_PAY_PASSPHRASE = 'integration-test-pass';
    await setup();
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    delete process.env.AGENTSCORE_PAY_PASSPHRASE;
    await rm(ROOT, { recursive: true, force: true });
  });

  it('rejects Solana with unsupported_rail (EVM-only feature)', async () => {
    const { revoke } = await import('../src/commands/revoke');
    await expect(
      revoke({ chain: 'solana', token: '0x' + '1'.repeat(40), spender: '0x' + '2'.repeat(40) }),
    ).rejects.toMatchObject({ code: 'unsupported_rail' });
  });

  it('rejects non-hex token addresses', async () => {
    const { revoke } = await import('../src/commands/revoke');
    await expect(
      revoke({ chain: 'base', token: 'not-an-address', spender: '0x' + '2'.repeat(40) }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('rejects non-hex spender addresses', async () => {
    const { revoke } = await import('../src/commands/revoke');
    await expect(
      revoke({ chain: 'base', token: '0x' + '1'.repeat(40), spender: 'invalid' }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('rejects EVM token without 0x prefix', async () => {
    const { revoke } = await import('../src/commands/revoke');
    await expect(
      revoke({ chain: 'base', token: 'abcdef'.repeat(7), spender: '0x' + '2'.repeat(40) }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('rejects when keystore for the chain does not exist', async () => {
    const { revoke } = await import('../src/commands/revoke');
    await expect(
      revoke({ chain: 'base', token: '0x' + '1'.repeat(40), spender: '0x' + '2'.repeat(40) }),
    ).rejects.toThrow();
  });

  it('wraps decryption failure as wrong_passphrase (loadWallet path)', async () => {
    await plantBaseKeystore();
    process.env.AGENTSCORE_PAY_PASSPHRASE = 'definitely-wrong-passphrase';
    const { revoke } = await import('../src/commands/revoke');
    await expect(
      revoke({ chain: 'base', token: '0x' + '1'.repeat(40), spender: '0x' + '2'.repeat(40) }),
    ).rejects.toMatchObject({ code: 'wrong_passphrase' });
  });
});
