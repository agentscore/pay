/**
 * `agentscore-pay send` — raw USDC transfer to an arbitrary recipient.
 *
 * Different from `pay <url>`: there is no merchant, no 402 handshake, no
 * MPP receipt. Just an on-chain transfer of USDC from the local wallet
 * to the destination address. Works on Base, Tempo (EVM), and Solana (SPL
 * transferChecked with idempotent ATA creation).
 *
 * Requires native gas in the source wallet (ETH on Base, the Tempo native
 * token on Tempo, SOL on Solana). x402/MPP payments are gasless from the
 * agent's perspective; raw transfers are not.
 */

import * as baseChain from '../chains/base';
import * as solanaChain from '../chains/solana';
import * as tempoChain from '../chains/tempo';
import { type Chain, type Network } from '../constants';
import { CliError } from '../errors';
import { DEFAULT_WALLET_NAME } from '../paths';
import { promptPassphrase } from '../prompts';
import { loadWallet } from '../wallets';

type Hex = `0x${string}`;
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

type SendAsset = 'usdc' | 'native';

export interface SendInput {
  chain: Chain;
  to: string;
  /** USDC (when asset='usdc') or native-gas (when asset='native') amount. */
  amount: number;
  asset?: SendAsset;
  network?: Network;
  name?: string;
}

export interface SendResult {
  ok: true;
  chain: Chain;
  network: Network;
  asset: SendAsset;
  from: string;
  to: string;
  amount_usdc?: string;
  amount_native?: string;
  native_symbol?: string;
  tx_hash: string;
}

function validateRecipient(chain: Chain, to: string): void {
  if (!to || !to.trim()) {
    throw new CliError('invalid_input', '--to is required.');
  }
  if (chain === 'solana') {
    if (!SOLANA_ADDRESS_RE.test(to)) {
      throw new CliError('invalid_wallet_address', `--to must be a base58 Solana address. Got: ${to}`);
    }
    return;
  }
  if (!EVM_ADDRESS_RE.test(to)) {
    throw new CliError('invalid_wallet_address', `--to must be a 0x-prefixed 40-hex EVM address. Got: ${to}`);
  }
  if (to.toLowerCase() === EVM_ZERO_ADDRESS) {
    throw new CliError('invalid_wallet_address', '--to cannot be the EVM zero address.');
  }
}

function mapGasError(err: unknown, chain: Chain, signer: string): never {
  // Errors already classified by the chain adapter (e.g. transfer_reverted from
  // on-chain receipt confirmation) pass through untouched; only an RPC-wrapped
  // submit failure gets sniffed for a native-gas shortfall.
  if (err instanceof CliError && err.code !== 'rpc_error' && err.code !== 'network_error') {
    throw err;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/insufficient funds|gas|fee/i.test(msg)) {
    const native = chain === 'base' ? 'ETH on Base' : chain === 'tempo' ? 'the Tempo native token' : 'SOL';
    throw new CliError('insufficient_balance', `${chain} wallet has no native gas to send the transfer.`, {
      nextSteps: {
        action: 'fund_native_gas',
        suggestion: `Send a small amount of ${native} to ${signer} and retry. x402/MPP payments don't need this; only raw on-chain transfers do.`,
      },
      extra: { chain, signer, original_message: msg },
    });
  }
  throw err;
}

const nativeAdapter = (chain: Chain) =>
  chain === 'base' ? baseChain : chain === 'tempo' ? tempoChain : solanaChain;

export async function send(input: SendInput): Promise<SendResult> {
  const network: Network = input.network ?? 'mainnet';
  const asset: SendAsset = input.asset ?? 'usdc';
  validateRecipient(input.chain, input.to);
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new CliError('invalid_amount', '--amount must be a positive number.');
  }

  const passphrase = await promptPassphrase();
  const wallet = await loadWallet(input.chain, passphrase, input.name ?? DEFAULT_WALLET_NAME);

  try {
    if (asset === 'native') {
      const adapter = nativeAdapter(input.chain);
      const result = await adapter.transferNative({
        key: wallet.secret as Buffer,
        to: input.to,
        amountNative: input.amount,
        network,
      });
      return { ok: true, chain: input.chain, network, asset, native_symbol: adapter.NATIVE_SYMBOL, ...result };
    }
    // asset = 'usdc'
    if (input.chain === 'base') {
      const result = await baseChain.transfer({
        key: wallet.secret as Buffer,
        to: input.to as Hex,
        amountUsd: input.amount,
        network,
      });
      return { ok: true, chain: 'base', network, asset, ...result };
    }
    if (input.chain === 'tempo') {
      const result = await tempoChain.transfer({
        key: wallet.secret as Buffer,
        to: input.to as Hex,
        amountUsd: input.amount,
        network,
      });
      return { ok: true, chain: 'tempo', network, asset, ...result };
    }
    const result = await solanaChain.transfer({
      key: wallet.secret as Buffer,
      to: input.to,
      amountUsd: input.amount,
      network,
    });
    return { ok: true, chain: 'solana', network, asset, ...result };
  } catch (err: unknown) {
    mapGasError(err, input.chain, wallet.address);
  }
}
