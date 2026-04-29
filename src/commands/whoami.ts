import * as baseChain from '../chains/base';
import * as solanaChain from '../chains/solana';
import * as tempoChain from '../chains/tempo';
import { loadConfig } from '../config';
import { SUPPORTED_CHAINS, type Chain, type Network } from '../constants';
import { keystoreExists, keystorePath, listWallets, loadKeystore } from '../keystore';

export interface WalletSummary {
  chain: Chain;
  name: string;
  address: string;
  balance_usdc: string;
  balance_raw: string;
  keystore: string;
}

export interface ChainSummary {
  chain: Chain;
  has_wallet: boolean;
  wallets: WalletSummary[];
}

export interface WhoamiResult {
  chains: ChainSummary[];
  config: { preferred_chains: string[] | null };
}

async function readBalance(chain: Chain, address: string, network: Network): Promise<bigint> {
  if (chain === 'base') return baseChain.balance(address, network);
  if (chain === 'solana') return solanaChain.balance(address, network);
  return tempoChain.balance(address, network);
}

function formatBalance(chain: Chain, raw: bigint): string {
  if (chain === 'base') return baseChain.formatBalance(raw);
  if (chain === 'solana') return solanaChain.formatBalance(raw);
  return tempoChain.formatBalance(raw);
}

async function summarize(chain: Chain, network: Network): Promise<ChainSummary> {
  const names = await listWallets(chain);
  if (names.length === 0) return { chain, has_wallet: false, wallets: [] };
  const wallets = await Promise.all(
    names.map(async (name) => {
      if (!(await keystoreExists(chain, name))) return null;
      const ks = await loadKeystore(chain, name);
      const raw = await readBalance(chain, ks.address, network);
      return {
        chain,
        name,
        address: ks.address,
        balance_usdc: formatBalance(chain, raw),
        balance_raw: raw.toString(),
        keystore: keystorePath(chain, name),
      } satisfies WalletSummary;
    }),
  );
  return {
    chain,
    has_wallet: true,
    wallets: wallets.filter((w): w is WalletSummary => w !== null),
  };
}

export async function whoami(input: { network?: Network } = {}): Promise<WhoamiResult> {
  const network: Network = input.network ?? 'mainnet';
  const [rows, config] = await Promise.all([
    Promise.all(SUPPORTED_CHAINS.map((c) => summarize(c, network))),
    loadConfig(),
  ]);
  return {
    chains: rows,
    config: { preferred_chains: config.preferred_chains ?? null },
  };
}
