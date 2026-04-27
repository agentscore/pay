import { isKnownUSDC } from '../constants';
import { CliError } from '../errors';
import { mergeHeaders } from '../headers';
import { isJson, writeJson, writeLine } from '../output';
import { chainFromNetworkId } from '../quotes';
import { lookupRailHint, type RailHint } from '../rail-hints';
import { challengeToRail, parsePaymentChallenges } from '../www-authenticate';

export interface CheckOptions {
  method: string;
  url: string;
  body?: string;
  headers?: Record<string, string>;
}

interface X402Accept {
  scheme?: string;
  network?: string;
  amount?: string;
  maxAmountRequired?: string;
  asset?: string;
  payTo?: string;
  description?: string;
  extra?: { name?: string; decimals?: number; version?: string };
}

interface MppAccept {
  method?: string;
  network?: string;
  chain_id?: number;
  token?: string;
  symbol?: string;
  decimals?: number;
  pay_to?: string;
}

interface RailSummary {
  protocol: 'x402' | 'mpp' | 'unknown';
  rail: string;
  network?: string;
  price_usd?: string;
  price_raw?: string;
  asset?: string;
  pay_to?: string;
  natively_supported: boolean;
  hint?: RailHint;
}

function safeBigInt(raw: string): bigint | null {
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

function normalizeX402(body: unknown): RailSummary[] {
  const record = body as { accepts?: X402Accept[] };
  const accepts = Array.isArray(record.accepts) ? record.accepts : [];
  return accepts.map((a) => {
    const chain = chainFromNetworkId(a.network);
    // x402 v1 uses `maxAmountRequired`; v2 uses `amount`. Decimals is never carried
    // at the top level — extra.decimals is best-effort, otherwise canonical USDC = 6,
    // unknown asset = leave price_usd undefined rather than displaying a wrong value.
    const declaredDecimals = a.extra?.decimals;
    const decimals = declaredDecimals ?? (chain && isKnownUSDC(a.asset, chain) ? 6 : null);
    const raw = a.amount ?? a.maxAmountRequired ?? '0';
    const parsed = safeBigInt(raw);
    const priceUsd =
      decimals !== null && parsed !== null ? (Number(parsed) / 10 ** decimals).toFixed(decimals) : undefined;
    const natively_supported = chain !== null;
    return {
      protocol: 'x402',
      rail: `${a.scheme ?? 'exact'}/${a.network ?? 'unknown'}`,
      network: a.network,
      price_usd: priceUsd,
      price_raw: raw,
      asset: a.asset,
      pay_to: a.payTo,
      natively_supported,
      hint: natively_supported ? undefined : lookupRailHint({ network: a.network, scheme: a.scheme }),
    } satisfies RailSummary;
  });
}

function challengeRailToSummary(c: ReturnType<typeof challengeToRail>): RailSummary {
  return {
    protocol: 'mpp',
    rail: c.rail,
    network: c.network,
    price_usd: c.price_usd,
    price_raw: c.price_raw,
    asset: c.asset,
    pay_to: c.pay_to,
    natively_supported: c.natively_supported,
    hint: c.hint,
  };
}

function normalizeMpp(body: unknown): RailSummary[] {
  const record = body as { accepted_methods?: MppAccept[] };
  const accepts = Array.isArray(record.accepted_methods) ? record.accepted_methods : [];
  const amountUsd = (body as { amount_usd?: string }).amount_usd;
  return accepts.map((a) => {
    const network = a.network ?? (a.chain_id ? `eip155:${a.chain_id}` : undefined);
    const natively_supported = a.method?.startsWith('tempo/') === true || chainFromNetworkId(network) !== null;
    return {
      protocol: 'mpp',
      rail: a.method ?? 'unknown',
      network,
      price_usd: amountUsd,
      asset: a.token,
      pay_to: a.pay_to,
      natively_supported,
      hint: natively_supported ? undefined : lookupRailHint({ method: a.method, network }),
    } satisfies RailSummary;
  });
}

export async function check(opts: CheckOptions): Promise<void> {
  const init: RequestInit = { method: opts.method };
  if (opts.body !== undefined) init.body = opts.body;
  init.headers = mergeHeaders({ 'Content-Type': 'application/json' }, opts.headers);

  let res: Response;
  try {
    res = await fetch(opts.url, init);
  } catch (err) {
    throw new CliError('network_error', err instanceof Error ? err.message : String(err), {
      nextSteps: { action: 'check_url_reachable', suggestion: 'Verify the URL is reachable from this machine.' },
    });
  }

  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // leave as raw string
  }

  if (res.status !== 402) {
    const payload = {
      status: res.status,
      status_text: res.statusText,
      payment_required: false,
      body,
    };
    if (isJson()) {
      writeJson(payload);
    } else {
      writeLine(`${opts.method} ${opts.url} → ${res.status} ${res.statusText}`);
      writeLine('No payment required (endpoint returned non-402 status).');
    }
    return;
  }

  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const isX402 = Array.isArray(record.accepts);
  const isMpp = Array.isArray(record.accepted_methods);
  const challenges = parsePaymentChallenges(res.headers);

  let rails: RailSummary[] = [];
  let protocol: 'x402' | 'mpp' | 'both' | 'unknown' = 'unknown';
  if (isX402 && isMpp) {
    rails = [...normalizeX402(body), ...normalizeMpp(body)];
    protocol = 'both';
  } else if (isX402) {
    rails = normalizeX402(body);
    protocol = 'x402';
  } else if (isMpp) {
    rails = normalizeMpp(body);
    protocol = 'mpp';
  }
  if (challenges.length > 0) {
    rails = [...rails, ...challenges.map(challengeToRail).map(challengeRailToSummary)];
    if (protocol === 'unknown') protocol = 'mpp';
    else if (protocol === 'x402') protocol = 'both';
  }

  const payload = {
    status: 402,
    status_text: res.statusText,
    payment_required: true,
    protocol,
    rails,
    body,
  };
  if (isJson()) {
    writeJson(payload);
    return;
  }

  writeLine(`${opts.method} ${opts.url} → 402 Payment Required (${protocol})`);
  if (rails.length === 0) {
    writeLine('  (could not parse accepted rails; see raw body below)');
    writeLine(text);
    return;
  }
  writeLine('');
  const native = rails.filter((r) => r.natively_supported);
  const other = rails.filter((r) => !r.natively_supported);
  if (native.length > 0) {
    writeLine('Accepted rails (natively supported by agentscore-pay):');
    for (const r of native) {
      const price = r.price_usd ? `$${r.price_usd}` : '?';
      writeLine(`  ${r.protocol.padEnd(5)} ${r.rail.padEnd(28)} ${price.padStart(10)}  pay_to=${r.pay_to ?? 'n/a'}`);
    }
  }
  if (other.length > 0) {
    if (native.length > 0) writeLine('');
    writeLine('Other rails accepted (use a compatible client):');
    for (const r of other) {
      const label = r.hint?.name ?? r.rail;
      const price = r.price_usd ? `$${r.price_usd}` : '?';
      writeLine(`  ${r.protocol.padEnd(5)} ${label.padEnd(28)} ${price.padStart(10)}`);
      if (r.hint?.recommended_client) {
        writeLine(`         → ${r.hint.recommended_client.name}${r.hint.recommended_client.install ? ` (${r.hint.recommended_client.install})` : ''}`);
      } else if (r.hint?.docs_url) {
        writeLine(`         → ${r.hint.docs_url}`);
      }
    }
  }
}
