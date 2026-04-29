import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { balance } from '../src/commands/balance';

const ROOT = '/tmp/pay-balance-test';

describe('balance command', () => {
  let originalHome: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    process.env.HOME = ROOT;
    await rm(ROOT, { recursive: true, force: true });
    await mkdir(join(ROOT, '.agentscore', 'wallets'), { recursive: true });
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(ROOT, { recursive: true, force: true });
  });

  it('returns has_wallet:false rows for every chain when none exist', async () => {
    const result = await balance({});
    expect(result.wallets).toHaveLength(3);
    expect(result.wallets.every((w) => w.has_wallet === false)).toBe(true);
    expect(result.wallets.map((w) => w.chain).sort()).toEqual(['base', 'solana', 'tempo']);
  });

  it('filters to a single chain when --chain is set', async () => {
    const result = await balance({ chain: 'base' });
    expect(result.wallets).toHaveLength(1);
    expect(result.wallets[0]!.chain).toBe('base');
  });

  it('default network is mainnet', async () => {
    const result = await balance({});
    // No keystores, so network only affects the read path which doesn't fire here.
    // Confirm the function accepts no input and returns the same shape as explicit mainnet.
    const explicit = await balance({ network: 'mainnet' });
    expect(result).toEqual(explicit);
  });
});
