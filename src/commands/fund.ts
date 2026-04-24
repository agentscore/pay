import { setTimeout as sleep } from 'timers/promises';
import qrcode from 'qrcode-terminal';
import * as baseChain from '../chains/base';
import * as solanaChain from '../chains/solana';
import * as tempoChain from '../chains/tempo';
import { onrampUrl, type Chain } from '../constants';
import { loadKeystore } from '../keystore';

const POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

async function readBalance(chain: Chain, address: string): Promise<bigint> {
  if (chain === 'base') return baseChain.balance(address);
  if (chain === 'solana') return solanaChain.balance(address);
  return tempoChain.balance(address);
}

function formatBalance(chain: Chain, raw: bigint): string {
  if (chain === 'base') return baseChain.formatBalance(raw);
  if (chain === 'solana') return solanaChain.formatBalance(raw);
  return tempoChain.formatBalance(raw);
}

function qrUri(chain: Chain, address: string, amountUsd?: number): string {
  if (chain === 'base') return baseChain.qrUri(address, amountUsd);
  if (chain === 'solana') return solanaChain.qrUri(address, amountUsd);
  return tempoChain.qrUri(address, amountUsd);
}

export async function fund(chain: Chain, amountUsd?: number): Promise<void> {
  const ks = await loadKeystore(chain);
  const url = onrampUrl(chain, ks.address, amountUsd);
  const uri = qrUri(chain, ks.address, amountUsd);

  console.log(`Fund ${chain} wallet ${ks.address}`);
  if (amountUsd) console.log(`Target amount: $${amountUsd} USDC`);
  console.log('');
  if (url) {
    console.log('Option A — Coinbase Onramp (card):');
    console.log(`  ${url}`);
    console.log('');
    console.log('Option B — scan QR with mobile wallet (Coinbase Wallet / Rabby / MetaMask):');
  } else if (chain === 'tempo') {
    console.log('Coinbase Onramp does not support Tempo. Options:');
    console.log('  • `tempo wallet fund` via the Tempo CLI');
    console.log('  • Transfer USDC.e (chain 4217) from an existing Tempo wallet:');
  }
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
      console.log(`✓ Deposit detected. Current balance: ${formatBalance(chain, current)} USDC`);
      return;
    }
  }
  console.warn('Timed out waiting for deposit. Run `agentscore-pay balance` to check manually.');
}
