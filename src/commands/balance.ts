import * as baseChain from '../chains/base';
import * as solanaChain from '../chains/solana';
import * as tempoChain from '../chains/tempo';
import { SUPPORTED_CHAINS, type Chain, type Network } from '../constants';
import { keystoreExists, loadKeystore } from '../keystore';
import { isJson, writeJson, writeLine } from '../output';

interface BalanceRow {
  chain: Chain;
  address?: string;
  usdc?: string;
  raw?: string;
  has_wallet: boolean;
}

async function readChain(chain: Chain, network: Network): Promise<BalanceRow> {
  if (!(await keystoreExists(chain))) return { chain, has_wallet: false };
  const ks = await loadKeystore(chain);
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
  return { chain, address: ks.address, usdc: formatted, raw: raw.toString(), has_wallet: true };
}

export async function balance(filter?: Chain, network: Network = 'mainnet'): Promise<void> {
  const chains = filter ? [filter] : [...SUPPORTED_CHAINS];
  const rows = await Promise.all(chains.map((c) => readChain(c, network)));
  rows.sort((a, b) => a.chain.localeCompare(b.chain));

  if (isJson()) {
    writeJson(rows);
    return;
  }
  for (const row of rows) {
    if (!row.has_wallet) {
      writeLine(`${row.chain.padEnd(8)} (no wallet)`);
    } else {
      writeLine(`${row.chain.padEnd(8)} ${(row.usdc ?? '0').padStart(14)} USDC  ${row.address}`);
    }
  }
}
