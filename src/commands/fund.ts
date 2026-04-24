import { setTimeout as sleep } from 'timers/promises';
import qrcode from 'qrcode-terminal';
import * as baseChain from '../chains/base';
import * as solanaChain from '../chains/solana';
import * as tempoChain from '../chains/tempo';
import { onrampUrl, type Chain, type Network } from '../constants';
import { loadKeystore } from '../keystore';
import { emitProgress, isJson, writeJson, writeLine } from '../output';
import { TEMPO_INSTALL_URL, locateTempoCli, spawnTempo } from '../tempo-cli';

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

function tempoFundArgs(address: string, network: Network): string[] {
  const args = ['wallet', 'fund', '--address', address];
  if (network === 'testnet') args.push('-n', 'testnet');
  return args;
}

function tempoFundCommand(binPath: string, address: string, network: Network): string {
  return `${binPath} ${tempoFundArgs(address, network).join(' ')}`;
}

async function fundTempo(address: string, network: Network): Promise<boolean> {
  if (isJson()) {
    // Machine mode: never hijack stdout/stdio for a subprocess. Caller sees the
    // tempo_wallet_fund action and decides whether to spawn it themselves.
    return false;
  }
  const cli = await locateTempoCli();
  if (!cli.found || !cli.path) return false;

  const args = tempoFundArgs(address, network);
  writeLine(`Handing off to Tempo CLI: ${cli.path} ${args.join(' ')}`);
  writeLine('');
  try {
    const { exitCode } = await spawnTempo(cli.path, args);
    if (exitCode !== 0) {
      writeLine('');
      writeLine(`Tempo CLI exited with code ${exitCode}. Run manually to debug: ${cli.path} ${args.join(' ')}`);
    }
  } catch (err) {
    writeLine('');
    writeLine(`Failed to launch tempo CLI: ${err instanceof Error ? err.message : String(err)}`);
    writeLine(`Install: ${TEMPO_INSTALL_URL}`);
    return false;
  }
  writeLine('');
  writeLine(`Resuming balance polling on ${address}…`);
  return true;
}

export async function fund(chain: Chain, amountUsd?: number, network: Network = 'mainnet'): Promise<void> {
  const ks = await loadKeystore(chain);
  const onramp = network === 'mainnet' ? onrampUrl(chain, ks.address, amountUsd) : null;
  const uri = buildQrUri(chain, ks.address, amountUsd, network);
  const tempoCli = chain === 'tempo' ? await locateTempoCli() : null;

  if (isJson()) {
    writeJson({
      chain,
      address: ks.address,
      amount_usd: amountUsd ?? null,
      onramp_url: onramp,
      qr_uri: uri,
      poll_interval_seconds: POLL_INTERVAL_MS / 1000,
      timeout_seconds: DEFAULT_TIMEOUT_MS / 1000,
      ...(chain === 'tempo'
        ? {
            tempo_cli_installed: Boolean(tempoCli?.found),
            tempo_cli_path: tempoCli?.path ?? null,
            tempo_install_url: TEMPO_INSTALL_URL,
            next_steps: {
              action: 'run_tempo_wallet_fund',
              suggestion: tempoCli?.found
                ? `Run: ${tempoFundCommand(tempoCli.path!, ks.address, network)}`
                : `Install the Tempo CLI from ${TEMPO_INSTALL_URL}, then run: tempo ${tempoFundArgs(ks.address, network).join(' ')}`,
            },
          }
        : {}),
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
      writeLine('Tempo is not supported by Coinbase Onramp. Options:');
      if (tempoCli?.found) {
        writeLine(`  • Hand off to Tempo CLI: ${tempoFundCommand(tempoCli.path!, ks.address, network)}`);
      } else {
        writeLine(
          `  • Install Tempo CLI (${TEMPO_INSTALL_URL}) then: tempo ${tempoFundArgs(ks.address, network).join(' ')}`,
        );
      }
      writeLine('  • Transfer USDC.e (chain 4217) from an existing Tempo wallet:');
    }
    qrcode.generate(uri, { small: true });
    writeLine('');
  }

  // In human mode on tempo with CLI available, hand off interactively before polling.
  if (chain === 'tempo' && !isJson() && tempoCli?.found) {
    await fundTempo(ks.address, network);
  } else if (!isJson()) {
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
        writeLine(`✓ Deposit detected. Current balance: ${formatted} USDC`);
      }
      return;
    }
    emitProgress('polling', { chain, address: ks.address, usdc: formatBalance(chain, current) });
  }
  emitProgress('timeout', { chain, address: ks.address });
}
