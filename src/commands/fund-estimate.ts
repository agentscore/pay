import * as baseChain from '../chains/base';
import * as solanaChain from '../chains/solana';
import * as tempoChain from '../chains/tempo';
import { CliError } from '../errors';
import { keystoreExists, loadKeystore } from '../keystore';
import { isJson, writeJson, writeLine } from '../output';
import { parseBody, type RailQuote } from '../quotes';
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

export async function fundEstimate(opts: FundEstimateOptions): Promise<void> {
  const network: Network = opts.network ?? 'mainnet';
  const init: RequestInit = { method: opts.method };
  if (opts.body !== undefined) init.body = opts.body;
  init.headers = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) };

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
    if (isJson()) {
      writeJson({ payment_required: false, status: res.status });
    } else {
      writeLine(`${opts.url} does not require payment (HTTP ${res.status}). Nothing to fund for.`);
    }
    return;
  }

  const quotes: RailQuote[] = parseBody(body);
  if (quotes.length === 0) {
    throw new CliError('merchant_error', 'Could not parse any rails from 402 body.', {
      extra: { raw_body: text.slice(0, 2000) },
    });
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

  if (isJson()) {
    writeJson({
      url: opts.url,
      method: opts.method,
      payment_required: true,
      quotes: rows,
    });
    return;
  }

  writeLine(`${opts.method} ${opts.url} → 402`);
  writeLine('');
  writeLine('Chain     Protocol  Price       Balance     Calls   Suggested top-up');
  for (const r of rows) {
    const price = r.price_usd !== undefined ? `$${r.price_usd.toFixed(6)}` : '?';
    const balance = r.balance_usd !== null ? `$${r.balance_usd.toFixed(6)}` : '(no wallet)';
    const calls =
      r.calls_affordable === null ? '-' : r.calls_affordable === 0 ? 'none' : String(r.calls_affordable);
    const topUp = r.suggested_top_up_usd_for_10_calls ?? 0;
    const suggest = topUp > 0 ? `fund ~$${topUp.toFixed(2)} for 10 calls` : 'covered';
    writeLine(
      `${r.chain.padEnd(9)} ${r.protocol.padEnd(9)} ${price.padStart(10)}  ${balance.padStart(12)}  ${calls.padStart(6)}  ${suggest}`,
    );
  }
}
