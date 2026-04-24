import * as baseChain from '../chains/base';
import * as solanaChain from '../chains/solana';
import * as tempoChain from '../chains/tempo';
import { SUPPORTED_CHAINS, type Chain } from '../constants';
import { loadKeystore } from '../keystore';

async function chainBalance(chain: Chain): Promise<{ address: string; raw: bigint; formatted: string } | null> {
  try {
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
    return { address: ks.address, raw, formatted };
  } catch {
    return null;
  }
}

export async function balance(filter?: Chain): Promise<void> {
  const chains = filter ? [filter] : [...SUPPORTED_CHAINS];
  const rows: Array<{ chain: Chain; address: string; formatted: string } | { chain: Chain; missing: true }> = [];
  await Promise.all(
    chains.map(async (chain) => {
      const result = await chainBalance(chain);
      rows.push(result ? { chain, address: result.address, formatted: result.formatted } : { chain, missing: true });
    }),
  );
  for (const row of rows.sort((a, b) => a.chain.localeCompare(b.chain))) {
    if ('missing' in row) {
      console.log(`${row.chain.padEnd(8)} (no wallet)`);
    } else {
      console.log(`${row.chain.padEnd(8)} ${row.formatted.padStart(14)} USDC  ${row.address}`);
    }
  }
}
