import { setTimeout as sleep } from 'timers/promises';
import qrcode from 'qrcode-terminal';
import * as baseChain from '../chains/base';
import * as solanaChain from '../chains/solana';
import * as tempoChain from '../chains/tempo';
import { type Chain, type Network } from '../constants';
import { CliError } from '../errors';
import { loadKeystore } from '../keystore';
import { createOnrampSession, OnrampApiError, type OnrampChain } from '../onramp';
import { DEFAULT_WALLET_NAME } from '../paths';
import { emitProgress } from '../progress';

const POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const TEMPO_TESTNET_MINT_TIMEOUT_MS = 30_000;
const TEMPO_TESTNET_POLL_MS = 2_000;

export type FundVia = 'stripe-onramp';

export interface FundInput {
  chain: Chain;
  amountUsd?: number;
  network?: Network;
  name?: string;
  via?: FundVia;
  sourceCurrency?: 'usd' | 'eur';
}

export interface FundResult {
  chain: Chain;
  network: Network;
  address: string;
  amount_usd: number | null;
  status: 'deposit_detected' | 'tempo_testnet_minted' | 'tempo_testnet_mint_pending' | 'timeout';
  qr_uri?: string;
  initial_usdc?: string;
  final_usdc?: string;
  poll_interval_seconds?: number;
  timeout_seconds?: number;
  tx_hashes?: string[];
  stablecoins_minted?: string[];
  via?: FundVia;
  onramp_session_id?: string;
  onramp_hosted_url?: string;
}

const isOnrampChain = (chain: Chain): chain is OnrampChain => chain === 'base' || chain === 'solana';

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

export async function fund(input: FundInput): Promise<FundResult> {
  const network = input.network ?? 'mainnet';
  const name = input.name ?? DEFAULT_WALLET_NAME;
  const ks = await loadKeystore(input.chain, name);

  if (input.via === 'stripe-onramp') {
    if (!isOnrampChain(input.chain)) {
      throw new CliError(
        'invalid_chain',
        `Stripe Crypto Onramp supports only base and solana. For ${input.chain}, run \`agentscore-pay fund --chain ${input.chain}\` (external wallet) instead.`,
        { nextSteps: { action: 'use_alternative_funding_method', suggestion: `agentscore-pay fund --chain ${input.chain}` } },
      );
    }
    if (network !== 'mainnet') {
      throw new CliError(
        'invalid_network',
        'Stripe Crypto Onramp only supports mainnet. For testnets, use `agentscore-pay fund --chain <chain> --network testnet` (faucet / programmatic mint).',
      );
    }
    if (!input.amountUsd || input.amountUsd <= 0) {
      throw new CliError(
        'invalid_amount',
        '--amount is required when --via stripe-onramp (USD amount to onramp).',
      );
    }

    let session;
    try {
      session = await createOnrampSession({
        walletAddress: ks.address,
        chain: input.chain,
        amountUsd: input.amountUsd,
        sourceCurrency: input.sourceCurrency,
      });
    } catch (err) {
      if (err instanceof OnrampApiError) {
        throw new CliError(err.code as never, err.message, {
          nextSteps: err.agentInstructions ?? undefined,
          extra: err.stripeRequestId ? { stripe_request_id: err.stripeRequestId } : undefined,
        });
      }
      throw err;
    }

    const initial = await readBalance(input.chain, ks.address, network);

    emitProgress('onramp_session_created', {
      session_id: session.session_id,
      hosted_url: session.hosted_url,
      chain: session.chain,
      network: session.network,
      wallet_address: session.wallet_address,
      amount_usd: input.amountUsd,
      locked: session.locked,
      poll_interval_seconds: POLL_INTERVAL_MS / 1000,
      timeout_seconds: DEFAULT_TIMEOUT_MS / 1000,
    });

    if (process.stderr.isTTY) {
      const ascii = await new Promise<string>((resolve) => {
        qrcode.generate(session.hosted_url, { small: true }, (q) => resolve(q));
      });
      const minutes = Math.round(DEFAULT_TIMEOUT_MS / 60_000);
      const seconds = POLL_INTERVAL_MS / 1000;
      process.stderr.write(
        `\nOpen Stripe Crypto Onramp in your browser:\n  ${session.hosted_url}\n\n${ascii}\n` +
          `Polling ${input.chain} balance every ${seconds}s (timeout ${minutes}m). The CLI does NOT auto-open the browser — click or scan the URL above to start the onramp flow.\n\n`,
      );
    }

    const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
    let current = initial;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      current = await readBalance(input.chain, ks.address, network);
      if (current > initial) {
        return {
          chain: input.chain,
          network,
          address: ks.address,
          amount_usd: input.amountUsd,
          status: 'deposit_detected',
          initial_usdc: formatBalance(input.chain, initial),
          final_usdc: formatBalance(input.chain, current),
          poll_interval_seconds: POLL_INTERVAL_MS / 1000,
          timeout_seconds: DEFAULT_TIMEOUT_MS / 1000,
          via: 'stripe-onramp',
          onramp_session_id: session.session_id,
          onramp_hosted_url: session.hosted_url,
        };
      }
    }
    return {
      chain: input.chain,
      network,
      address: ks.address,
      amount_usd: input.amountUsd,
      status: 'timeout',
      initial_usdc: formatBalance(input.chain, initial),
      final_usdc: formatBalance(input.chain, current),
      poll_interval_seconds: POLL_INTERVAL_MS / 1000,
      timeout_seconds: DEFAULT_TIMEOUT_MS / 1000,
      via: 'stripe-onramp',
      onramp_session_id: session.session_id,
      onramp_hosted_url: session.hosted_url,
    };
  }

  if (input.chain === 'tempo' && network === 'testnet') {
    const initial = await tempoChain.balance(ks.address, 'testnet');
    const txs = await tempoChain.fundTestnet(ks.address);
    const balance = await pollTempoTestnetBalance(ks.address, initial);
    const confirmed = balance > initial;
    return {
      chain: 'tempo',
      network: 'testnet',
      address: ks.address,
      amount_usd: input.amountUsd ?? null,
      status: confirmed ? 'tempo_testnet_minted' : 'tempo_testnet_mint_pending',
      tx_hashes: txs,
      stablecoins_minted: ['pathUSD', 'AlphaUSD', 'BetaUSD', 'ThetaUSD'],
      initial_usdc: tempoChain.formatBalance(initial),
      final_usdc: tempoChain.formatBalance(balance),
    };
  }

  const uri = buildQrUri(input.chain, ks.address, input.amountUsd, network);
  const initial = await readBalance(input.chain, ks.address, network);

  // Surface the receive surface BEFORE the poll loop so the user sees actionable
  // info immediately. Without this, fund() silently polls for up to 15 minutes
  // and only renders at the end. JSON consumers get the structured event on
  // stderr; TTY users additionally see the rendered QR + status message.
  emitProgress('funding_started', {
    chain: input.chain,
    network,
    address: ks.address,
    amount_usd: input.amountUsd ?? null,
    qr_uri: uri,
    poll_interval_seconds: POLL_INTERVAL_MS / 1000,
    timeout_seconds: DEFAULT_TIMEOUT_MS / 1000,
  });
  if (process.stderr.isTTY) {
    const ascii = await new Promise<string>((resolve) => {
      qrcode.generate(uri, { small: true }, (q) => resolve(q));
    });
    const minutes = Math.round(DEFAULT_TIMEOUT_MS / 60_000);
    const seconds = POLL_INTERVAL_MS / 1000;
    process.stderr.write(
      `\nSend USDC on ${input.chain} (${network}) to:\n  ${ks.address}\n\n${ascii}\n` +
        `Polling balance every ${seconds}s (timeout ${minutes}m). Send from any wallet, exchange, or fiat onramp; pay will detect the deposit and exit.\n\n`,
    );
  }

  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  let current = initial;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    current = await readBalance(input.chain, ks.address, network);
    if (current > initial) {
      return {
        chain: input.chain,
        network,
        address: ks.address,
        amount_usd: input.amountUsd ?? null,
        status: 'deposit_detected',
        qr_uri: uri,
        initial_usdc: formatBalance(input.chain, initial),
        final_usdc: formatBalance(input.chain, current),
        poll_interval_seconds: POLL_INTERVAL_MS / 1000,
        timeout_seconds: DEFAULT_TIMEOUT_MS / 1000,
      };
    }
  }
  return {
    chain: input.chain,
    network,
    address: ks.address,
    amount_usd: input.amountUsd ?? null,
    status: 'timeout',
    qr_uri: uri,
    initial_usdc: formatBalance(input.chain, initial),
    final_usdc: formatBalance(input.chain, current),
    poll_interval_seconds: POLL_INTERVAL_MS / 1000,
    timeout_seconds: DEFAULT_TIMEOUT_MS / 1000,
  };
}
