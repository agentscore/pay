import { setTimeout as sleep } from 'timers/promises';
import qrcode from 'qrcode-terminal';
import * as baseChain from '../chains/base';
import * as solanaChain from '../chains/solana';
import * as tempoChain from '../chains/tempo';
import { onrampUrl, type Chain } from '../constants';
import { loadKeystore } from '../keystore';
import { emitProgress, isJson, writeJson, writeLine } from '../output';

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

function buildQrUri(chain: Chain, address: string, amountUsd?: number): string {
  if (chain === 'base') return baseChain.qrUri(address, amountUsd);
  if (chain === 'solana') return solanaChain.qrUri(address, amountUsd);
  return tempoChain.qrUri(address, amountUsd);
}

export async function fund(chain: Chain, amountUsd?: number): Promise<void> {
  const ks = await loadKeystore(chain);
  const onramp = onrampUrl(chain, ks.address, amountUsd);
  const uri = buildQrUri(chain, ks.address, amountUsd);

  if (isJson()) {
    writeJson({
      chain,
      address: ks.address,
      amount_usd: amountUsd ?? null,
      onramp_url: onramp,
      qr_uri: uri,
      poll_interval_seconds: POLL_INTERVAL_MS / 1000,
      timeout_seconds: DEFAULT_TIMEOUT_MS / 1000,
    });
  } else {
    writeLine(`Fund ${chain} wallet ${ks.address}`);
    if (amountUsd) writeLine(`Target amount: $${amountUsd} USDC`);
    writeLine('');
    if (onramp) {
      writeLine('Option A — Coinbase Onramp (card):');
      writeLine(`  ${onramp}`);
      writeLine('');
      writeLine('Option B — scan QR with a mobile wallet (Coinbase Wallet / Rabby / MetaMask):');
    } else if (chain === 'tempo') {
      writeLine('Coinbase Onramp does not support Tempo. Options:');
      writeLine('  • `tempo wallet fund` via the Tempo CLI');
      writeLine('  • Transfer USDC.e (chain 4217) from an existing Tempo wallet');
      writeLine('');
    }
    qrcode.generate(uri, { small: true });
    writeLine('');
    writeLine('Polling balance every 5s. Ctrl+C to exit.');
  }

  const initial = await readBalance(chain, ks.address);
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  let current = initial;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    current = await readBalance(chain, ks.address);
    if (current > initial) {
      const formatted = formatBalance(chain, current);
      if (isJson()) {
        writeJson({ event: 'deposit_detected', chain, address: ks.address, usdc: formatted });
      } else {
        writeLine(`✓ Deposit detected. Current balance: ${formatted} USDC`);
      }
      return;
    }
    emitProgress('polling', { chain, address: ks.address, usdc: formatBalance(chain, current) });
  }
  emitProgress('timeout', { chain, address: ks.address });
}
