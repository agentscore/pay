import { setTimeout as sleep } from 'timers/promises';
import qrcode from 'qrcode-terminal';
import * as baseChain from '../chains/base';
import * as solanaChain from '../chains/solana';
import * as tempoChain from '../chains/tempo';
import { bold, cyan, dim, green, yellow } from '../colors';
import { onrampUrl, type Chain, type Network } from '../constants';
import { loadKeystore } from '../keystore';
import { emitProgress, isJson, writeJson, writeLine } from '../output';
import { DEFAULT_WALLET_NAME } from '../paths';

const POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

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

function buildQrUri(chain: Chain, address: string, amountUsd?: number, network: Network = 'mainnet'): string {
  if (chain === 'base') return baseChain.qrUri(address, amountUsd, network);
  if (chain === 'solana') return solanaChain.qrUri(address, amountUsd, network);
  return tempoChain.qrUri(address, amountUsd, network);
}

const TEMPO_TESTNET_MINT_TIMEOUT_MS = 30_000;
const TEMPO_TESTNET_POLL_MS = 2_000;

async function pollTempoTestnetBalance(address: string, initial: bigint): Promise<bigint> {
  const deadline = Date.now() + TEMPO_TESTNET_MINT_TIMEOUT_MS;
  let current = initial;
  while (Date.now() < deadline) {
    await sleep(TEMPO_TESTNET_POLL_MS);
    current = await tempoChain.balance(address, 'testnet');
    if (current > initial) return current;
  }
  return current;
}

async function fundTempoTestnet(address: string): Promise<void> {
  const initial = await tempoChain.balance(address, 'testnet');
  const txs = await tempoChain.fundTestnet(address);
  if (!isJson()) {
    writeLine(`${green('✓')} Funded tempo testnet wallet ${cyan(address)}`);
    writeLine(dim('  via tempo_fundAddress JSON-RPC — minted pathUSD + AlphaUSD + BetaUSD + ThetaUSD'));
    for (const hash of txs) writeLine(dim(`  tx: ${hash}`));
    writeLine(dim('  Waiting for mint to confirm…'));
  }
  const balance = await pollTempoTestnetBalance(address, initial);
  const formatted = tempoChain.formatBalance(balance);
  const confirmed = balance > initial;
  if (isJson()) {
    writeJson({
      event: 'deposit_detected',
      chain: 'tempo',
      network: 'testnet',
      address,
      method: 'tempo_fundAddress',
      tx_hashes: txs,
      stablecoins_minted: ['pathUSD', 'AlphaUSD', 'BetaUSD', 'ThetaUSD'],
      usdc: formatted,
      confirmed,
      ...(confirmed ? {} : { note: 'mint pending; balance read timed out, check again shortly' }),
    });
    return;
  }
  if (confirmed) {
    writeLine(`${green('✓')} Confirmed. Current USDC.e balance: ${bold(formatted)} USDC`);
  } else {
    writeLine(yellow(`(mint pending — balance still ${formatted} USDC after ${TEMPO_TESTNET_MINT_TIMEOUT_MS / 1000}s; rerun \`balance --chain tempo --network testnet\` shortly)`));
  }
}

export async function fund(chain: Chain, amountUsd?: number, network: Network = 'mainnet', name: string = DEFAULT_WALLET_NAME): Promise<void> {
  const ks = await loadKeystore(chain, name);

  if (chain === 'tempo' && network === 'testnet') {
    await fundTempoTestnet(ks.address);
    return;
  }

  const onramp = network === 'mainnet' ? onrampUrl(chain, ks.address, amountUsd) : null;
  const uri = buildQrUri(chain, ks.address, amountUsd, network);

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

  const initial = await readBalance(chain, ks.address, network);
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  let current = initial;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    current = await readBalance(chain, ks.address, network);
    if (current > initial) {
      const formatted = formatBalance(chain, current);
      if (isJson()) {
        writeJson({ event: 'deposit_detected', chain, address: ks.address, usdc: formatted });
      } else {
        writeLine(`${green('✓')} Deposit detected. Current balance: ${bold(formatted)} USDC`);
      }
      return;
    }
    emitProgress('polling', { chain, address: ks.address, usdc: formatBalance(chain, current) });
  }
  emitProgress('timeout', { chain, address: ks.address });
}
