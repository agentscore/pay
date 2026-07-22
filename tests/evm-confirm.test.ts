import { BaseError, ContractFunctionRevertedError } from 'viem';
import { describe, expect, it } from 'vitest';
import { confirmEvmTransfer, isEvmRevert, type ReceiptReader, transferRevertedError } from '../src/chains/evm-confirm';
import { CliError } from '../src/errors';

type Hex = `0x${string}`;
const HASH = ('0x' + 'ab'.repeat(32)) as Hex;

const reader = (impl: () => Promise<{ status: 'success' | 'reverted' }>): ReceiptReader => ({
  waitForTransactionReceipt: impl,
});

describe('confirmEvmTransfer', () => {
  it('resolves when the receipt status is success', async () => {
    await expect(
      confirmEvmTransfer(reader(async () => ({ status: 'success' })), HASH, {
        chain: 'tempo',
        network: 'mainnet',
        asset: 'usdc',
      }),
    ).resolves.toBeUndefined();
  });

  it('throws transfer_reverted when the tx reverted on-chain', async () => {
    await expect(
      confirmEvmTransfer(reader(async () => ({ status: 'reverted' })), HASH, {
        chain: 'tempo',
        network: 'mainnet',
        asset: 'usdc',
      }),
    ).rejects.toMatchObject({ code: 'transfer_reverted' });
  });

  it('carries the tx hash and a Tempo fee-headroom hint on revert', async () => {
    const err = await confirmEvmTransfer(reader(async () => ({ status: 'reverted' })), HASH, {
      chain: 'tempo',
      network: 'mainnet',
      asset: 'usdc',
    }).catch((e: unknown) => e as CliError);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).extra).toMatchObject({ tx_hash: HASH, chain: 'tempo' });
    expect((err as CliError).message).toMatch(/stablecoin/i);
    expect((err as CliError).message).toMatch(/headroom/i);
  });

  it('gives a generic recipient/amount hint on non-Tempo chains', async () => {
    const err = await confirmEvmTransfer(reader(async () => ({ status: 'reverted' })), HASH, {
      chain: 'base',
      network: 'mainnet',
      asset: 'usdc',
    }).catch((e: unknown) => e as CliError);
    expect((err as CliError).message).toMatch(/spendable balance/i);
    expect((err as CliError).message).not.toMatch(/stablecoin/i);
  });

  it('wraps a receipt-polling RPC failure as rpc_error', async () => {
    await expect(
      confirmEvmTransfer(
        reader(async () => {
          throw new Error('socket hang up');
        }),
        HASH,
        { chain: 'base', network: 'mainnet', asset: 'native' },
      ),
    ).rejects.toMatchObject({ code: 'rpc_error' });
  });

  it('maps transfer_reverted to the payment-rejected exit code', async () => {
    const { exitCodeForError } = await import('../src/errors');
    expect(exitCodeForError('transfer_reverted')).toBe(4);
  });
});

describe('isEvmRevert', () => {
  it('recognizes a viem contract-revert error (estimation-stage revert)', () => {
    const revert = new ContractFunctionRevertedError({
      abi: [],
      functionName: 'transfer',
      message: 'execution reverted: TIP20 token error: InsufficientBalance',
    });
    const wrapped = new BaseError('The contract function "transfer" reverted.', { cause: revert });
    expect(isEvmRevert(wrapped)).toBe(true);
  });

  it('does not treat a plain network error as a revert', () => {
    expect(isEvmRevert(new Error('socket hang up'))).toBe(false);
    expect(isEvmRevert(new BaseError('HTTP request failed'))).toBe(false);
  });
});

describe('transferRevertedError', () => {
  it('omits tx_hash when the revert happened before submission', () => {
    const err = transferRevertedError({ chain: 'tempo', network: 'mainnet', asset: 'usdc' });
    expect(err.code).toBe('transfer_reverted');
    expect(err.extra).not.toHaveProperty('tx_hash');
    expect(err.message).toMatch(/stablecoin/i);
  });

  it('names the native asset for native transfers', () => {
    const err = transferRevertedError({ chain: 'base', network: 'mainnet', asset: 'native' });
    expect(err.message).toMatch(/native transfer reverted/i);
  });
});
