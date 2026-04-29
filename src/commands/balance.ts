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
  has_wallet: boolean;
}

async function readChain(chain: Chain, network: Network, name: string): Promise<BalanceRow> {
  if (!(await keystoreExists(chain, name))) return { chain, name, has_wallet: false };
  const ks = await loadKeystore(chain, name);
  const raw =
    chain === 'base'
      ? await baseChain.balance(ks.address, network)
      : chain === 'solana'
        ? await solanaChain.balance(ks.address, network)
        : await tempoChain.balance(ks.address, network);
  const formatted =
    chain === 'base'
      ? baseChain.formatBalance(raw)
      : chain === 'solana'
        ? solanaChain.formatBalance(raw)
        : tempoChain.formatBalance(raw);
  return { chain, name, address: ks.address, usdc: formatted, raw: raw.toString(), has_wallet: true };
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
