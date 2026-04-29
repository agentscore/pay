import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ROOT = '/tmp/pay-selection-test';

async function writeKeystore(chain: 'base' | 'solana' | 'tempo', address: string) {
  const file = join(ROOT, '.agentscore', 'wallets', `${chain}.json`);
  const dummy = {
    version: 1,
    chain,
    address,
    encryption: {
      kdf: 'scrypt',
      kdfParams: { N: 16384, r: 8, p: 1, saltHex: '00'.repeat(16) },
      cipher: 'aes-256-gcm',
      cipherIv: '00'.repeat(12),
      cipherAuthTag: '00'.repeat(16),
      ciphertext: '00'.repeat(32),
    },
  };
  await writeFile(file, JSON.stringify(dummy));
}

async function writeConfig(obj: Record<string, unknown>) {
  await writeFile(join(ROOT, '.agentscore', 'config.json'), JSON.stringify(obj));
}

async function setup() {
  await rm(ROOT, { recursive: true, force: true });
  await mkdir(join(ROOT, '.agentscore', 'wallets'), { recursive: true });
}

describe('selectRail', () => {
  let originalHome: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    process.env.HOME = ROOT;
    await setup();
    vi.resetModules();
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(ROOT, { recursive: true, force: true });
    vi.doUnmock('../src/chains/base');
    vi.doUnmock('../src/chains/solana');
    vi.doUnmock('../src/chains/tempo');
  });

  async function mockBalances(balances: { base?: bigint; solana?: bigint; tempo?: bigint }) {
    vi.doMock('../src/chains/base', async () => {
      const actual = await vi.importActual<typeof import('../src/chains/base')>('../src/chains/base');
      return { ...actual, balance: async () => balances.base ?? 0n };
    });
    vi.doMock('../src/chains/solana', async () => {
      const actual = await vi.importActual<typeof import('../src/chains/solana')>('../src/chains/solana');
      return { ...actual, balance: async () => balances.solana ?? 0n };
    });
    vi.doMock('../src/chains/tempo', async () => {
      const actual = await vi.importActual<typeof import('../src/chains/tempo')>('../src/chains/tempo');
      return { ...actual, balance: async () => balances.tempo ?? 0n };
    });
  }

  it('errors when no wallets exist', async () => {
    await mockBalances({});
    const { selectRail } = await import('../src/selection');
    await expect(selectRail()).rejects.toMatchObject({ code: 'no_wallet' });
  });

  it('auto-uses the only held wallet', async () => {
    await writeKeystore('base', '0xbase');
    await mockBalances({ base: 0n });
    const { selectRail } = await import('../src/selection');
    const picked = await selectRail();
    expect(picked.chain).toBe('base');
  });

  it('respects --chain override', async () => {
    await writeKeystore('base', '0xbase');
    await writeKeystore('tempo', '0xtempo');
    await mockBalances({ base: 100n, tempo: 100n });
    const { selectRail } = await import('../src/selection');
    const picked = await selectRail({ chainOverride: 'tempo' });
    expect(picked.chain).toBe('tempo');
  });

  it('errors on chain override with no wallet', async () => {
    await writeKeystore('base', '0xbase');
    await mockBalances({ base: 100n });
    const { selectRail } = await import('../src/selection');
    await expect(selectRail({ chainOverride: 'solana' })).rejects.toMatchObject({ code: 'no_wallet' });
  });

  it('errors on chain override with insufficient balance', async () => {
    await writeKeystore('base', '0xbase');
    await mockBalances({ base: 10n });
    const { selectRail } = await import('../src/selection');
    await expect(selectRail({ chainOverride: 'base', minBalanceRaw: 100n })).rejects.toMatchObject({
      code: 'insufficient_balance',
    });
  });

  it('errors multi_rail_candidates when multiple funded and no config', async () => {
    await writeKeystore('base', '0xbase');
    await writeKeystore('tempo', '0xtempo');
    await mockBalances({ base: 100n, tempo: 100n });
    const { selectRail } = await import('../src/selection');
    await expect(selectRail({ minBalanceRaw: 50n })).rejects.toMatchObject({ code: 'multi_rail_candidates' });
  });

  it('uses preferred_chains config tiebreaker', async () => {
    await writeKeystore('base', '0xbase');
    await writeKeystore('tempo', '0xtempo');
    await writeConfig({ preferred_chains: ['tempo', 'base'] });
    await mockBalances({ base: 100n, tempo: 100n });
    const { selectRail } = await import('../src/selection');
    const picked = await selectRail({ minBalanceRaw: 50n });
    expect(picked.chain).toBe('tempo');
  });

  it('falls through when preferred_chains lists only unfunded chains', async () => {
    await writeKeystore('base', '0xbase');
    await writeKeystore('tempo', '0xtempo');
    await writeConfig({ preferred_chains: ['solana'] });
    await mockBalances({ base: 100n, tempo: 100n });
    const { selectRail } = await import('../src/selection');
    await expect(selectRail({ minBalanceRaw: 50n })).rejects.toMatchObject({ code: 'multi_rail_candidates' });
  });

  it('errors no_funded_rail when none meet minBalance', async () => {
    await writeKeystore('base', '0xbase');
    await mockBalances({ base: 5n });
    const { selectRail } = await import('../src/selection');
    await expect(selectRail({ minBalanceRaw: 100n })).rejects.toMatchObject({ code: 'no_funded_rail' });
  });

  describe('named wallets (--wallet)', () => {
    async function writeNamedKeystore(chain: 'base' | 'solana' | 'tempo', name: string, address: string) {
      const file = join(ROOT, '.agentscore', 'wallets', `${chain}-${name}.json`);
      const dummy = {
        version: 1,
        chain,
        address,
        name,
        encryption: {
          kdf: 'scrypt',
          kdfParams: { N: 16384, r: 8, p: 1, saltHex: '00'.repeat(16) },
          cipher: 'aes-256-gcm',
          cipherIv: '00'.repeat(12),
          cipherAuthTag: '00'.repeat(16),
          ciphertext: '00'.repeat(32),
        },
      };
      await writeFile(file, JSON.stringify(dummy));
    }

    it('selects a named wallet when --wallet is passed', async () => {
      await writeNamedKeystore('base', 'trading', '0xtradingbase');
      await mockBalances({ base: 100n });
      const { selectRail } = await import('../src/selection');
      const picked = await selectRail({ chainOverride: 'base', walletName: 'trading', minBalanceRaw: 50n });
      expect(picked.chain).toBe('base');
      expect(picked.name).toBe('trading');
      expect(picked.address).toBe('0xtradingbase');
    });

    it('errors no_wallet when --wallet name has no keystore', async () => {
      await writeKeystore('base', '0xbase');
      await mockBalances({ base: 100n });
      const { selectRail } = await import('../src/selection');
      await expect(
        selectRail({ chainOverride: 'base', walletName: 'trading' }),
      ).rejects.toMatchObject({ code: 'no_wallet' });
    });

    it('default name falls back to legacy <chain>.json', async () => {
      await writeKeystore('base', '0xlegacy');
      await mockBalances({ base: 50n });
      const { selectRail } = await import('../src/selection');
      const picked = await selectRail({ chainOverride: 'base', walletName: 'default' });
      expect(picked.address).toBe('0xlegacy');
      expect(picked.name).toBe('default');
    });

    it('legacy <chain>.json is invisible to non-default wallet names', async () => {
      await writeKeystore('base', '0xlegacy');
      await mockBalances({ base: 50n });
      const { selectRail } = await import('../src/selection');
      await expect(
        selectRail({ chainOverride: 'base', walletName: 'trading' }),
      ).rejects.toMatchObject({ code: 'no_wallet' });
    });

    it('walletName surfaces in CliError extra payload', async () => {
      const { selectRail } = await import('../src/selection');
      try {
        await selectRail({ walletName: 'agent-1' });
        throw new Error('should have rejected');
      } catch (err: unknown) {
        expect((err as { extra: Record<string, unknown> }).extra.wallet_name).toBe('agent-1');
      }
    });
  });
});
