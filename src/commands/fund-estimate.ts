import * as baseChain from '../chains/base';
import * as solanaChain from '../chains/solana';
import * as tempoChain from '../chains/tempo';
import { CliError } from '../errors';
import { mergeHeaders } from '../headers';
import { keystoreExists, loadKeystore } from '../keystore';
import { parseBody, type RailQuote, type UnsupportedRail } from '../quotes';
import type { Chain, Network } from '../constants';

export interface FundEstimateOptions {
  url: string;
  method: string;
  body?: string;
  headers?: Record<string, string>;
  chain?: Chain;
  network?: Network;
}

async function balanceUsd(chain: Chain, network: Network, address: string): Promise<number> {
  const raw =
    chain === 'base'
      ? await baseChain.balance(address, network)
      : chain === 'solana'
        ? await solanaChain.balance(address, network)
        : await tempoChain.balance(address, network);
  return Number(raw) / 1_000_000;
}

export interface FundEstimateResult {
  url: string;
  method: string;
  payment_required: boolean;
  status?: number;
  quotes?: Array<RailQuote & {
    has_wallet: boolean;
    balance_usd: number | null;
    calls_affordable: number | null;
    deficit_for_one_usd: number | null;
    suggested_top_up_usd_for_10_calls: number | null;
  }>;
  unsupported_rails?: UnsupportedRail[];
}

export async function fundEstimate(opts: FundEstimateOptions): Promise<FundEstimateResult> {
  const network: Network = opts.network ?? 'mainnet';
  const init: RequestInit = { method: opts.method };
  if (opts.body !== undefined) init.body = opts.body;
  init.headers = mergeHeaders({ 'Content-Type': 'application/json' }, opts.headers);

  let res: Response;
  try {
    res = await fetch(opts.url, init);
  } catch (err) {
    throw new CliError('network_error', err instanceof Error ? err.message : String(err), {
      nextSteps: { action: 'check_url_reachable' },
    });
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // leave as null
  }

  if (res.status !== 402) {
    return { url: opts.url, method: opts.method, payment_required: false, status: res.status };
  }

  const { supported: quotes, unsupported }: { supported: RailQuote[]; unsupported: UnsupportedRail[] } = parseBody(body, res.headers);
  if (quotes.length === 0) {
    throw new CliError(
      'merchant_error',
      unsupported.length > 0
        ? `Merchant only accepts rails not natively supported by agentscore-pay: ${unsupported.map(formatUnsupportedLabel).join(', ')}.`
        : 'Could not parse any rails from 402 body.',
      {
        extra: {
          raw_body: text.slice(0, 2000),
          ...(unsupported.length > 0 ? { unsupported_rails: unsupported } : {}),
        },
      },
    );
  }

  const rows = await Promise.all(
    quotes.map(async (q) => {
      const funded = await keystoreExists(q.chain);
      let balance: number | null = null;
      if (funded) {
        const ks = await loadKeystore(q.chain);
        balance = await balanceUsd(q.chain, network, ks.address);
      }
      const price = q.price_usd ?? 0;
      const callsAffordable = balance !== null && price > 0 ? Math.floor(balance / price) : null;
      const deficitForOne = balance !== null && price > 0 ? Math.max(0, price - balance) : null;
      const desiredBuffer = price * 10;
      const suggestedTopUp =
        balance !== null && price > 0 ? Math.max(0, Math.ceil(desiredBuffer - balance)) : null;
      return {
        ...q,
        has_wallet: funded,
        balance_usd: balance,
        calls_affordable: callsAffordable,
        deficit_for_one_usd: deficitForOne,
        suggested_top_up_usd_for_10_calls: suggestedTopUp,
      };
    }),
  );

  if (opts.chain) rows.sort((a, b) => (a.chain === opts.chain ? -1 : b.chain === opts.chain ? 1 : 0));

  return {
    url: opts.url,
    method: opts.method,
    payment_required: true,
    quotes: rows,
    ...(unsupported.length > 0 ? { unsupported_rails: unsupported } : {}),
  };
}

function formatUnsupportedLabel(u: UnsupportedRail): string {
  if (u.hint?.name) return u.hint.name;
  if (u.protocol === 'x402') return `${u.scheme ?? 'exact'}/${u.network ?? 'unknown'}`;
  return u.method ?? u.network ?? 'unknown';
}
