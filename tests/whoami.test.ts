import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { whoami } from '../src/commands/whoami';

const ROOT = '/tmp/pay-whoami-test';

describe('whoami command', () => {
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

  it('returns chains[] + config block on a fresh home', async () => {
    const result = await whoami();
    expect(result.chains).toHaveLength(3);
    expect(result.chains.every((c) => c.has_wallet === false)).toBe(true);
    expect(result.config.preferred_chains).toBeNull();
  });

  it('honors --network testnet', async () => {
    const result = await whoami({ network: 'testnet' });
    expect(result.chains).toHaveLength(3);
  });
});
