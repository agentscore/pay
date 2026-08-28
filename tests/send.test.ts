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

  // Spend limits applied to the 402 paths but not to `send`, so a configured
  // ceiling could be walked straight past by using a raw transfer instead.
  it('refuses a USDC transfer that exceeds a configured per-call limit', async () => {
    const { saveLimits } = await import('../src/limits');
    await saveLimits({ per_call_usd: 5 });
    const { send } = await import('../src/commands/send');
    await expect(
      send({ amount: 50, chain: 'base', to: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }),
    ).rejects.toThrow(/limit/i);
  });

  // The guard must be inert for anyone who never configured limits, which is
  // the default and is how the agent fleet runs.
  it('does not block when no limits are configured', async () => {
    const { send } = await import('../src/commands/send');
    // Fails later for a missing keystore, NOT on the limit check. Asserting the
    // message discriminates: a limit rejection here would be a false positive
    // for every unconfigured user.
    await expect(
      send({ amount: 50, chain: 'base', to: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }),
    ).rejects.not.toThrow(/limit/i);
  });

  // A native transfer moves gas tokens this command does not price in dollars,
  // so a USD ceiling cannot judge it and must not pretend to.
  it('does not apply the USD limit to a native transfer', async () => {
    const { saveLimits } = await import('../src/limits');
    await saveLimits({ per_call_usd: 5 });
    const { send } = await import('../src/commands/send');
    await expect(
      send({ amount: 50, asset: 'native', chain: 'base', to: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }),
    ).rejects.not.toThrow(/limit/i);
  });

  it('rejects empty --to', async () => {
    const { send } = await import('../src/commands/send');
    await expect(
      send({ chain: 'base', to: '', amount: 1 }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('rejects non-hex EVM --to on base', async () => {
    const { send } = await import('../src/commands/send');
    await expect(
      send({ chain: 'base', to: 'not-an-address', amount: 1 }),
    ).rejects.toMatchObject({ code: 'invalid_wallet_address' });
  });

  it('rejects EVM zero address on base', async () => {
    const { send } = await import('../src/commands/send');
    await expect(
      send({ chain: 'base', to: '0x' + '0'.repeat(40), amount: 1 }),
    ).rejects.toMatchObject({ code: 'invalid_wallet_address' });
  });

  it('rejects non-base58 --to on solana', async () => {
    const { send } = await import('../src/commands/send');
    await expect(
      send({ chain: 'solana', to: '0x' + '1'.repeat(40), amount: 1 }),
    ).rejects.toMatchObject({ code: 'invalid_wallet_address' });
  });

  it('rejects EVM --to without 0x prefix on tempo', async () => {
    const { send } = await import('../src/commands/send');
    await expect(
      send({ chain: 'tempo', to: 'abcdef'.repeat(7), amount: 1 }),
    ).rejects.toMatchObject({ code: 'invalid_wallet_address' });
  });

  it('rejects zero amount', async () => {
    const { send } = await import('../src/commands/send');
    await expect(
      send({ chain: 'base', to: '0x' + '1'.repeat(40), amount: 0 }),
    ).rejects.toMatchObject({ code: 'invalid_amount' });
  });

  it('rejects negative amount', async () => {
    const { send } = await import('../src/commands/send');
    await expect(
      send({ chain: 'base', to: '0x' + '1'.repeat(40), amount: -5 }),
    ).rejects.toMatchObject({ code: 'invalid_amount' });
  });

  it('rejects NaN amount', async () => {
    const { send } = await import('../src/commands/send');
    await expect(
      send({ chain: 'base', to: '0x' + '1'.repeat(40), amount: Number.NaN }),
    ).rejects.toMatchObject({ code: 'invalid_amount' });
  });

  it('rejects when keystore for the chain does not exist (after validation passes)', async () => {
    const { send } = await import('../src/commands/send');
    await expect(
      send({ chain: 'base', to: '0x' + '1'.repeat(40), amount: 1 }),
    ).rejects.toThrow();
  });

  it('rejects invalid base58 on solana with asset=native', async () => {
    const { send } = await import('../src/commands/send');
    await expect(
      send({ chain: 'solana', to: '0x' + '1'.repeat(40), amount: 0.01, asset: 'native' }),
    ).rejects.toMatchObject({ code: 'invalid_wallet_address' });
  });

  it('accepts asset=native via the same input shape', async () => {
    // Validation still applies — empty --to fails before keystore load.
    const { send } = await import('../src/commands/send');
    await expect(
      send({ chain: 'base', to: '', amount: 0.005, asset: 'native' }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
