import * as baseChain from '../chains/base';
import * as solanaChain from '../chains/solana';
import * as tempoChain from '../chains/tempo';
import { loadConfig } from '../config';
import { SUPPORTED_CHAINS, type Chain } from '../constants';
import { keystoreExists, keystorePath, loadKeystore } from '../keystore';
import { isJson, writeJson, writeLine } from '../output';

interface ChainSummary {
  chain: Chain;
  has_wallet: boolean;
  address?: string;
  balance_usdc?: string;
  keystore?: string;
}

async function summarize(chain: Chain): Promise<ChainSummary> {
  if (!(await keystoreExists(chain))) return { chain, has_wallet: false };
  const ks = await loadKeystore(chain);
  const raw =
    chain === 'base'
      ? await baseChain.balance(ks.address)
      : chain === 'solana'
        ? await solanaChain.balance(ks.address)
        : await tempoChain.balance(ks.address);
  const formatted =
    chain === 'base'
      ? baseChain.formatBalance(raw)
      : chain === 'solana'
        ? solanaChain.formatBalance(raw)
        : tempoChain.formatBalance(raw);
  return {
    chain,
    has_wallet: true,
    address: ks.address,
    balance_usdc: formatted,
    keystore: keystorePath(chain),
  };
}

export async function whoami(): Promise<void> {
  const [rows, config] = await Promise.all([
    Promise.all(SUPPORTED_CHAINS.map((c) => summarize(c))),
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

  writeLine('Wallets:');
  for (const row of rows) {
    if (!row.has_wallet) {
      writeLine(`  ${row.chain.padEnd(8)} (no wallet)`);
      continue;
    }
    writeLine(`  ${row.chain.padEnd(8)} ${row.balance_usdc?.padStart(14)} USDC  ${row.address}`);
  }
  writeLine('');
  if (config.preferred_chains) {
    writeLine(`Preferred chains: ${config.preferred_chains.join(' > ')}`);
  } else {
    writeLine('No config preference set. (agent picks via --chain or single-candidate auto-use)');
  }
}
