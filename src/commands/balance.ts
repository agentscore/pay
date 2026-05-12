import * as baseChain from '../chains/base';
import * as solanaChain from '../chains/solana';
import * as tempoChain from '../chains/tempo';
import { SUPPORTED_CHAINS, type Chain, type Network } from '../constants';
import { keystoreExists, loadKeystore } from '../keystore';
import { DEFAULT_WALLET_NAME } from '../paths';

export interface BalanceRow {
  chain: Chain;
  name: string;
  address?: string;
  usdc?: string;
  raw?: string;
  /** Native-gas balance: ETH on Base, native token on Tempo, SOL on Solana. */
  native?: string;
  native_symbol?: string;
  native_raw?: string;
  has_wallet: boolean;
}

async function readChain(chain: Chain, network: Network, name: string): Promise<BalanceRow> {
  if (!(await keystoreExists(chain, name))) return { chain, name, has_wallet: false };
  const ks = await loadKeystore(chain, name);
  const adapter = chain === 'base' ? baseChain : chain === 'solana' ? solanaChain : tempoChain;
  const [usdcRaw, nativeRaw] = await Promise.all([
    adapter.balance(ks.address, network),
    adapter.nativeBalance(ks.address, network),
  ]);
  return {
    chain,
    name,
    address: ks.address,
    usdc: adapter.formatBalance(usdcRaw),
    raw: usdcRaw.toString(),
    native: adapter.formatNative(nativeRaw),
    native_symbol: adapter.NATIVE_SYMBOL,
    native_raw: nativeRaw.toString(),
    has_wallet: true,
  };
}

export interface BalanceInput {
  chain?: Chain;
  network?: Network;
  name?: string;
}

export async function balance(input: BalanceInput = {}): Promise<{ wallets: BalanceRow[] }> {
  const network: Network = input.network ?? 'mainnet';
  const name = input.name ?? DEFAULT_WALLET_NAME;
  const chains = input.chain ? [input.chain] : [...SUPPORTED_CHAINS];
  const rows = await Promise.all(chains.map((c) => readChain(c, network, name)));
  rows.sort((a, b) => a.chain.localeCompare(b.chain));
  return { wallets: rows };
}
