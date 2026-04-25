import { bold, cyan, dim, yellow } from '../colors';
import { CliError } from '../errors';
import { isJson, writeJson, writeLine } from '../output';
import { chainFromNetworkId } from '../quotes';
import type { Chain } from '../constants';

const BAZAAR_URL = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources';
const FETCH_TIMEOUT_MS = 10_000;

interface BazaarAccept {
  scheme?: string;
  network?: string;
  asset?: string;
  payTo?: string;
  amount?: string;
  maxAmountRequired?: string;
  extra?: { decimals?: number; totalUsd?: number; name?: string };
}

interface BazaarItem {
  description?: string;
  accepts?: BazaarAccept[];
  extensions?: { agentkit?: { info?: { uri?: string; domain?: string } } };
}

interface BazaarResponse {
  items?: BazaarItem[];
}

export interface DiscoverOptions {
  search?: string;
  chain?: Chain;
  maxPriceUsd?: number;
  limit?: number;
}

interface NormalizedRail {
  chain: Chain | null;
  network?: string;
  scheme?: string;
  price_usd?: number;
  pay_to?: string;
  asset?: string;
}

interface NormalizedService {
  url?: string;
  domain?: string;
  description?: string;
  rails: NormalizedRail[];
  cheapest_usd?: number;
}

export async function discover(opts: DiscoverOptions = {}): Promise<void> {
  const items = await fetchBazaar();
  const normalized = items.map(normalize);
  const filtered = applyFilters(normalized, opts);
  const limited = opts.limit ? filtered.slice(0, opts.limit) : filtered;

  if (isJson()) {
    writeJson({ count: filtered.length, returned: limited.length, services: limited });
    return;
  }

  if (limited.length === 0) {
    writeLine(yellow('No services match the given filters.'));
    return;
  }

  writeLine(`${bold(String(limited.length))} services from ${dim('x402.org/bazaar')}:`);
  writeLine('');
  for (const svc of limited) {
    const price = svc.cheapest_usd !== undefined ? `$${svc.cheapest_usd.toFixed(svc.cheapest_usd < 0.01 ? 4 : 2)}` : '?';
    writeLine(`  ${bold(price.padStart(8))}  ${cyan(svc.url ?? svc.domain ?? '(unknown)')}`);
    if (svc.description) writeLine(`            ${dim(svc.description.slice(0, 80))}`);
    const railSummary = svc.rails
      .filter((r) => r.chain)
      .map((r) => `${r.chain}/${r.scheme ?? 'exact'}`)
      .join(', ');
    if (railSummary) writeLine(`            ${dim(`rails: ${railSummary}`)}`);
  }
}

async function fetchBazaar(): Promise<BazaarItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(BAZAAR_URL, { signal: controller.signal });
    if (!res.ok) {
      throw new CliError('network_error', `x402 Bazaar returned ${res.status}: ${res.statusText}`, {
        nextSteps: { action: 'retry_or_check_status', suggestion: 'The Coinbase Bazaar may be temporarily unavailable.' },
      });
    }
    const body = (await res.json()) as BazaarResponse;
    return Array.isArray(body.items) ? body.items : [];
  } catch (err) {
    if (err instanceof CliError) throw err;
    if (controller.signal.aborted) {
      throw new CliError('session_timeout', `x402 Bazaar request timed out after ${FETCH_TIMEOUT_MS / 1000}s.`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new CliError('network_error', `Failed to reach x402 Bazaar: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

function normalize(item: BazaarItem): NormalizedService {
  const rails: NormalizedRail[] = (item.accepts ?? []).map((a) => {
    const decimals = a.extra?.decimals ?? 6;
    const raw = a.amount ?? a.maxAmountRequired ?? '0';
    let price_usd: number | undefined;
    if (typeof a.extra?.totalUsd === 'number') {
      price_usd = a.extra.totalUsd;
    } else {
      try {
        price_usd = Number(BigInt(raw)) / 10 ** decimals;
      } catch {
        price_usd = undefined;
      }
    }
    return {
      chain: chainFromNetworkId(a.network),
      network: a.network,
      scheme: a.scheme,
      price_usd,
      pay_to: a.payTo,
      asset: a.asset,
    };
  });
  const prices = rails.map((r) => r.price_usd).filter((p): p is number => typeof p === 'number');
  return {
    url: item.extensions?.agentkit?.info?.uri,
    domain: item.extensions?.agentkit?.info?.domain,
    description: item.description,
    rails,
    cheapest_usd: prices.length > 0 ? Math.min(...prices) : undefined,
  };
}

function applyFilters(services: NormalizedService[], opts: DiscoverOptions): NormalizedService[] {
  const search = opts.search?.toLowerCase();
  return services.filter((svc) => {
    if (opts.chain) {
      if (!svc.rails.some((r) => r.chain === opts.chain)) return false;
    }
    if (opts.maxPriceUsd !== undefined) {
      if (svc.cheapest_usd === undefined || svc.cheapest_usd > opts.maxPriceUsd) return false;
    }
    if (search) {
      const haystack = `${svc.url ?? ''} ${svc.domain ?? ''} ${svc.description ?? ''}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}
