/**
 * Classify and confirm EVM transfers so a revert never looks like success.
 *
 * A raw transfer can fail two ways:
 *   1. Gas estimation reverts and viem's `writeContract` throws before the tx
 *      is ever submitted (e.g. --amount already exceeds the balance).
 *   2. Estimation passes, the tx is submitted, and it reverts when mined.
 *      viem's `writeContract` / `sendTransaction` resolve as soon as the tx is
 *      accepted into the mempool, so a hash comes back even though the tx later
 *      reverts and no funds move.
 *
 * `isEvmRevert` recognizes case 1; `confirmEvmTransfer` (via a receipt check)
 * recognizes case 2. Both surface the same `transfer_reverted` error.
 *
 * The most common revert is a full-balance transfer on Tempo: the network fee
 * is paid in the stablecoin itself, so sending the entire balance leaves
 * nothing for the fee and the token reverts with an insufficient-balance error.
 */

import { BaseError, ContractFunctionRevertedError, ExecutionRevertedError } from 'viem';
import { type Chain, type Network } from '../constants';
import { CliError, wrapRpcError } from '../errors';

type Hex = `0x${string}`;

// Typed by the one member we call, with the widest argument the caller
// passes and the narrowest result we read. viem 2.56.3 made the Tempo chain's
// client types portable and its method signatures stopped being assignable to
// a hand-written `{ hash }` parameter, so the parameter is typed `any`-shaped
// through the client's own method and the result is narrowed on read.
export interface ReceiptReader {
  waitForTransactionReceipt(args: { hash: Hex }): Promise<{ status: string }>;
}

interface RevertCtx {
  chain: Chain;
  network: Network;
  asset: 'usdc' | 'native';
  hash?: Hex;
}

/** True when a caught error is an on-chain execution revert (not an RPC/network fault). */
export function isEvmRevert(err: unknown): boolean {
  return (
    err instanceof BaseError &&
    Boolean(err.walk((e) => e instanceof ContractFunctionRevertedError || e instanceof ExecutionRevertedError))
  );
}

export function transferRevertedError(ctx: RevertCtx): CliError {
  const feeNote =
    ctx.chain === 'tempo'
      ? ' Tempo pays the network fee in the stablecoin, so a transfer of your entire balance leaves nothing for the fee. Retry with a slightly lower --amount to leave headroom for the fee.'
      : ' Check the recipient and that --amount does not exceed your spendable balance, then retry.';
  return new CliError(
    'transfer_reverted',
    `The ${ctx.asset === 'usdc' ? 'USDC' : 'native'} transfer reverted on-chain, so no funds moved.${feeNote}`,
    {
      nextSteps: { action: 'retry_with_headroom', suggestion: feeNote.trim() },
      extra: { chain: ctx.chain, network: ctx.network, ...(ctx.hash ? { tx_hash: ctx.hash } : {}) },
    },
  );
}

/** Wait for the receipt and turn a reverted (but mined) tx into a clear error. */
export async function confirmEvmTransfer(
  client: ReceiptReader,
  hash: Hex,
  ctx: { chain: Chain; network: Network; asset: 'usdc' | 'native' },
): Promise<void> {
  let status: string;
  try {
    ({ status } = await client.waitForTransactionReceipt({ hash }));
  } catch (err: unknown) {
    throw wrapRpcError(ctx.chain, ctx.network, err);
  }
  if (status === 'success') return;
  throw transferRevertedError({ ...ctx, hash });
}
