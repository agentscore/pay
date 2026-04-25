import * as baseChain from '../chains/base';
import * as solanaChain from '../chains/solana';
import * as tempoChain from '../chains/tempo';
import { bold, cyan, dim } from '../colors';
import { loadConfig } from '../config';
import { SUPPORTED_CHAINS, type Chain, type Network } from '../constants';
import { keystoreExists, keystorePath, listWallets, loadKeystore } from '../keystore';
import { isJson, writeJson, writeLine } from '../output';

interface WalletSummary {
  chain: Chain;
  name: string;
  address: string;
  balance_usdc: string;
  balance_raw: string;
  keystore: string;
}

interface ChainSummary {
  chain: Chain;
  has_wallet: boolean;
  wallets: WalletSummary[];
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

export async function whoami(network: Network = 'mainnet'): Promise<void> {
  const [rows, config] = await Promise.all([
    Promise.all(SUPPORTED_CHAINS.map((c) => summarize(c, network))),
    loadConfig(),
  ]);

  if (isJson()) {
    writeJson({
      chains: rows,
      config: {
        preferred_chains: config.preferred_chains ?? null,
      },
    });
    return;
  }

  writeLine(bold('Wallets:'));
  for (const row of rows) {
    if (!row.has_wallet) {
      writeLine(`  ${row.chain.padEnd(8)} ${dim('(no wallet)')}`);
      continue;
    }
    for (const w of row.wallets) {
      const tag = w.name === 'default' ? '' : `  [${w.name}]`;
      writeLine(`  ${row.chain.padEnd(8)} ${w.balance_usdc.padStart(14)} USDC  ${cyan(w.address)}${dim(tag)}`);
    }
  }
  writeLine('');
  if (config.preferred_chains) {
    writeLine(`Preferred chains: ${bold(config.preferred_chains.join(' > '))}`);
  } else {
    writeLine(dim('No config preference set. (agent picks via --chain or single-candidate auto-use)'));
  }
}
