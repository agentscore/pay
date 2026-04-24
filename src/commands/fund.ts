import { setTimeout as sleep } from 'timers/promises';
import qrcode from 'qrcode-terminal';
import * as baseChain from '../chains/base';
import * as solanaChain from '../chains/solana';
import { onrampUrl, type Chain } from '../constants';
import { loadKeystore } from '../keystore';

const POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

async function readBalance(chain: Chain, address: string): Promise<bigint> {
  return chain === 'base' ? baseChain.balance(address) : solanaChain.balance(address);
}

export async function fund(chain: Chain, amountUsd?: number): Promise<void> {
  const ks = await loadKeystore(chain);
  const url = onrampUrl(chain, ks.address, amountUsd);
  const uri = chain === 'base' ? baseChain.qrUri(ks.address, amountUsd) : solanaChain.qrUri(ks.address, amountUsd);

  console.log(`Fund ${chain} wallet ${ks.address}`);
  if (amountUsd) console.log(`Target amount: $${amountUsd} USDC`);
  console.log('');
  console.log('Option A — Coinbase Onramp (card):');
  console.log(`  ${url}`);
  console.log('');
  console.log('Option B — scan QR with mobile wallet (Coinbase Wallet / Rabby / MetaMask):');
  qrcode.generate(uri, { small: true });
  console.log('');
  console.log('Polling balance every 5s. Ctrl+C to exit.');

  const initial = await readBalance(chain, ks.address);
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  let current = initial;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    current = await readBalance(chain, ks.address);
    if (current > initial) {
      const fmt = chain === 'base' ? baseChain.formatBalance(current) : solanaChain.formatBalance(current);
      console.log(`✓ Deposit detected. Current balance: ${fmt} USDC`);
      return;
    }
  }
  console.warn('Timed out waiting for deposit. Run `agentscore-x402 balance` to check manually.');
}
