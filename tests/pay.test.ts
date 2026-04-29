import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pay } from '../src/commands/pay';

const ROOT = '/tmp/pay-pay-test';

describe('pay command', () => {
  let originalHome: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    process.env.HOME = ROOT;
    process.env.AGENTSCORE_PAY_PASSPHRASE = 'integration-test-pass';
    await rm(ROOT, { recursive: true, force: true });
    await mkdir(join(ROOT, '.agentscore', 'wallets'), { recursive: true });
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    delete process.env.AGENTSCORE_PAY_PASSPHRASE;
    await rm(ROOT, { recursive: true, force: true });
  });

  it('rejects with no_wallet when no wallets exist', async () => {
    await expect(
      pay({ method: 'POST', url: 'https://m.example/x', maxSpendUsd: 5 }),
    ).rejects.toMatchObject({ code: 'no_wallet' });
  });

  it('rejects with no_wallet when --chain is set but the wallet does not exist', async () => {
    await expect(
      pay({ chain: 'base', method: 'POST', url: 'https://m.example/x', maxSpendUsd: 5 }),
    ).rejects.toMatchObject({ code: 'no_wallet' });
  });
});
