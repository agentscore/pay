import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = '/tmp/pay-send-test';

async function setup() {
  await rm(ROOT, { recursive: true, force: true });
  await mkdir(join(ROOT, '.agentscore', 'wallets'), { recursive: true });
}

describe('send command — input validation', () => {
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

  it('rejects empty --to', async () => {
    const { send } = await import('../src/commands/send');
    await expect(
      send({ chain: 'base', to: '', amountUsd: 1 }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('rejects non-hex EVM --to on base', async () => {
    const { send } = await import('../src/commands/send');
    await expect(
      send({ chain: 'base', to: 'not-an-address', amountUsd: 1 }),
    ).rejects.toMatchObject({ code: 'invalid_wallet_address' });
  });

  it('rejects EVM zero address on base', async () => {
    const { send } = await import('../src/commands/send');
    await expect(
      send({ chain: 'base', to: '0x' + '0'.repeat(40), amountUsd: 1 }),
    ).rejects.toMatchObject({ code: 'invalid_wallet_address' });
  });

  it('rejects non-base58 --to on solana', async () => {
    const { send } = await import('../src/commands/send');
    await expect(
      send({ chain: 'solana', to: '0x' + '1'.repeat(40), amountUsd: 1 }),
    ).rejects.toMatchObject({ code: 'invalid_wallet_address' });
  });

  it('rejects EVM --to without 0x prefix on tempo', async () => {
    const { send } = await import('../src/commands/send');
    await expect(
      send({ chain: 'tempo', to: 'abcdef'.repeat(7), amountUsd: 1 }),
    ).rejects.toMatchObject({ code: 'invalid_wallet_address' });
  });

  it('rejects zero amount', async () => {
    const { send } = await import('../src/commands/send');
    await expect(
      send({ chain: 'base', to: '0x' + '1'.repeat(40), amountUsd: 0 }),
    ).rejects.toMatchObject({ code: 'invalid_amount' });
  });

  it('rejects negative amount', async () => {
    const { send } = await import('../src/commands/send');
    await expect(
      send({ chain: 'base', to: '0x' + '1'.repeat(40), amountUsd: -5 }),
    ).rejects.toMatchObject({ code: 'invalid_amount' });
  });

  it('rejects NaN amount', async () => {
    const { send } = await import('../src/commands/send');
    await expect(
      send({ chain: 'base', to: '0x' + '1'.repeat(40), amountUsd: Number.NaN }),
    ).rejects.toMatchObject({ code: 'invalid_amount' });
  });

  it('rejects when keystore for the chain does not exist (after validation passes)', async () => {
    const { send } = await import('../src/commands/send');
    await expect(
      send({ chain: 'base', to: '0x' + '1'.repeat(40), amountUsd: 1 }),
    ).rejects.toThrow();
  });
});
