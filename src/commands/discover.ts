import { bold, cyan, dim, yellow } from '../colors';
import { CliError } from '../errors';
import { isJson, writeJson, writeLine } from '../output';
import { chainFromNetworkId } from '../quotes';
import type { Chain } from '../constants';

const X402_BAZAAR_URL = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources';
const MPP_SERVICES_URL = 'https://mpp.dev/api/services';
const FETCH_TIMEOUT_MS = 10_000;

export type DiscoverProtocol = 'x402' | 'mpp' | 'both';

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

interface MppEndpointPayment {
  intent: string;
  method: string;
  amount?: string;
  currency?: string;
  decimals?: number;
  description?: string;
}

interface MppEndpoint {
  method: string;
  path: string;
  description?: string;
  payment?: MppEndpointPayment | null;
}

interface MppService {
  id: string;
  name: string;
  url: string;
  serviceUrl?: string;
  description?: string;
  categories?: string[];
  status?: string;
  methods?: Record<string, { intents: string[]; assets?: string[] }>;
  endpoints?: MppEndpoint[];
}

interface MppResponse {
  version?: string;
  services?: MppService[];
}

export interface DiscoverOptions {
  search?: string;
  chain?: Chain;
  maxPriceUsd?: number;
  limit?: number;
  protocol?: DiscoverProtocol;
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
  source: 'x402' | 'mpp';
  url?: string;
  domain?: string;
  description?: string;
  categories?: string[];
  rails: NormalizedRail[];
  cheapest_usd?: number;
}

export async function discover(opts: DiscoverOptions = {}): Promise<void> {
  const protocol = opts.protocol ?? 'both';
  const sources: Promise<NormalizedService[]>[] = [];
  if (protocol === 'x402' || protocol === 'both') sources.push(fetchX402());
  if (protocol === 'mpp' || protocol === 'both') sources.push(fetchMpp());

  const results = await Promise.allSettled(sources);
  const errors: string[] = [];
  const merged: NormalizedService[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') merged.push(...r.value);
    else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
  }

  if (merged.length === 0 && errors.length > 0) {
    throw new CliError('network_error', `All discovery sources failed: ${errors.join('; ')}`, {
      nextSteps: { action: 'retry_or_check_status', suggestion: 'The Bazaar / MPP registries may be temporarily unavailable.' },
    });
  }

  const filtered = applyFilters(merged, opts);
  const limited = opts.limit ? filtered.slice(0, opts.limit) : filtered;

  if (isJson()) {
    writeJson({
      count: filtered.length,
      returned: limited.length,
      sources_failed: errors,
      services: limited,
    });
    return;
  }

  if (limited.length === 0) {
    writeLine(yellow('No services match the given filters.'));
    return;
  }

  writeLine(`${bold(String(limited.length))} services from ${dim('x402 Bazaar + mpp.dev/services')}:`);
  writeLine('');
  for (const svc of limited) {
    const price = svc.cheapest_usd !== undefined ? `$${svc.cheapest_usd.toFixed(svc.cheapest_usd < 0.01 ? 4 : 2)}` : '?';
    const tag = svc.source === 'x402' ? dim('[x402]') : dim('[mpp]');
    writeLine(`  ${bold(price.padStart(8))}  ${tag}  ${cyan(svc.url ?? svc.domain ?? '(unknown)')}`);
    if (svc.description) writeLine(`                    ${dim(svc.description.slice(0, 76))}`);
    const railSummary = svc.rails
      .filter((r) => r.chain)
      .map((r) => `${r.chain}/${r.scheme ?? svc.source}`)
      .join(', ');
    if (railSummary) writeLine(`                    ${dim(`rails: ${railSummary}`)}`);
  }
  if (errors.length > 0) {
    writeLine('');
    writeLine(yellow(`(some sources failed: ${errors.join('; ')})`));
  }
}

async function fetchWithTimeout(url: string, label: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`${label} returned ${res.status}: ${res.statusText}`);
    }
    return await res.json();
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`${label} request timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchX402(): Promise<NormalizedService[]> {
  const body = (await fetchWithTimeout(X402_BAZAAR_URL, 'x402 Bazaar')) as BazaarResponse;
  const items = Array.isArray(body.items) ? body.items : [];
  return items.map(normalizeX402);
}

async function fetchMpp(): Promise<NormalizedService[]> {
  const body = (await fetchWithTimeout(MPP_SERVICES_URL, 'MPP services')) as MppResponse;
  const services = Array.isArray(body.services) ? body.services : [];
  return services.map(normalizeMpp);
}

function normalizeX402(item: BazaarItem): NormalizedService {
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
    source: 'x402',
    url: item.extensions?.agentkit?.info?.uri,
    domain: item.extensions?.agentkit?.info?.domain,
    description: item.description,
    rails,
    cheapest_usd: prices.length > 0 ? Math.min(...prices) : undefined,
  };
}

function normalizeMpp(svc: MppService): NormalizedService {
  const rails: NormalizedRail[] = [];
  for (const ep of svc.endpoints ?? []) {
    if (!ep.payment) continue;
    const decimals = ep.payment.decimals ?? 6;
    const raw = ep.payment.amount ?? '0';
    let price_usd: number | undefined;
    try {
      price_usd = Number(BigInt(raw)) / 10 ** decimals;
    } catch {
      price_usd = undefined;
    }
    const chain: Chain | null = ep.payment.method === 'tempo' ? 'tempo' : null;
    rails.push({
      chain,
      network: ep.payment.method,
      scheme: ep.payment.method,
      price_usd,
      asset: ep.payment.currency,
    });
  }
  const prices = rails.map((r) => r.price_usd).filter((p): p is number => typeof p === 'number');
  return {
    source: 'mpp',
    url: svc.url,
    domain: svc.serviceUrl,
    description: svc.description,
    categories: svc.categories,
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
      const haystack = `${svc.url ?? ''} ${svc.domain ?? ''} ${svc.description ?? ''} ${(svc.categories ?? []).join(' ')}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}
