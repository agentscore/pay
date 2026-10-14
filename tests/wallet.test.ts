import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  walletAddress,
  walletCreate,
  walletExport,
  walletImport,
  walletList,
  walletRemove,
  walletShowMnemonic,
} from '../src/commands/wallet';

const ROOT = '/tmp/pay-wallet-test';

describe('wallet commands', () => {
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

  it('walletList returns empty arrays when no keystores exist', async () => {
    const result = await walletList();
    expect(result.wallets).toHaveLength(3);
    expect(result.wallets.every((w) => w.names.length === 0)).toBe(true);
  });

  it('walletAddress rejects with no_wallet on missing keystore', async () => {
    await expect(walletAddress({ chain: 'base' })).rejects.toMatchObject({ code: 'no_wallet' });
  });

  it('walletExport requires --danger', async () => {
    await expect(walletExport({ chain: 'base' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('walletRemove requires --danger', async () => {
    await expect(walletRemove({ chain: 'base' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('walletShowMnemonic requires --danger', async () => {
    await expect(walletShowMnemonic({})).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('walletShowMnemonic rejects with no_wallet when no mnemonic stored', async () => {
    await expect(walletShowMnemonic({ danger: true, skipConfirm: true })).rejects.toMatchObject({
      code: 'no_wallet',
    });
  });

  it('walletCreate creates a single base wallet on demand', async () => {
    const result = await walletCreate({ chain: 'base', name: 'default' });
    expect(result.created).toHaveLength(1);
    expect(result.created[0]!.chain).toBe('base');
    expect(result.created[0]!.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('walletCreate rejects with wallet_exists on a single-chain re-create', async () => {
    await walletCreate({ chain: 'base' });
    await expect(walletCreate({ chain: 'base' })).rejects.toMatchObject({ code: 'wallet_exists' });
  });

  it('walletCreate is idempotent across multi-chain when one already exists', async () => {
    // Create base first, then ask for all chains — base should be skipped, solana + tempo created.
    await walletCreate({ chain: 'base' });
    const result = await walletCreate({});
    expect(result.created.map((c) => c.chain).sort()).toEqual(['solana', 'tempo']);
    expect(result.skipped.map((c) => c.chain)).toEqual(['base']);
  });

  it('creates nano only when named, never as part of the default set', async () => {
    const all = await walletCreate({});
    expect(all.created.map((c) => c.chain).sort()).toEqual(['base', 'solana', 'tempo']);
    const nano = await walletCreate({ chain: 'nano' });
    expect(nano.created[0]).toMatchObject({ chain: 'nano', qr_uri: expect.stringMatching(/^nano:nano_/) });
    expect(nano.created[0]!.address).toMatch(/^nano_[13][13456789abcdefghijkmnopqrstuwxyz]{59}$/);
  });

  it('imports a raw nano key into a keystore under its nano_ address', async () => {
    const key = '9f0e444c69f77a49bd0be89db92c38fe713e0963165cca12faf5712d7657120f';
    const result = await walletImport({ chain: 'nano', key });
    expect(result.address).toBe('nano_3i1aq1cchnmbn9x5rsbap8b15akfh7wj7pwskuzi7ahz8oq6cobd99d4r3b7');
    await expect(walletAddress({ chain: 'nano' })).resolves.toMatchObject({ address: result.address });
  });
});
