import { lookupRailHint, type RailHint } from './rail-hints';
import { challengeToRail, parsePaymentChallenges } from './www-authenticate';
import type { Chain } from './constants';

function safeBigInt(raw: string): bigint | null {
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

export interface RailQuote {
  chain: Chain;
  price_usd?: number;
  decimals?: number;
  price_raw?: string;
  asset?: string;
  pay_to?: string;
  protocol: 'x402' | 'mpp';
}

export interface UnsupportedRail {
  protocol: 'x402' | 'mpp';
  scheme?: string;
  method?: string;
  network?: string;
  asset?: string;
  pay_to?: string;
  price_raw?: string;
  hint?: RailHint;
}

export interface ParsedRails {
  supported: RailQuote[];
  unsupported: UnsupportedRail[];
}

interface X402Accept {
  scheme?: string;
  network?: string;
  maxAmountRequired?: string;
  asset?: string;
  payTo?: string;
  extra?: { decimals?: number };
}

interface MppAccept {
  method?: string;
  network?: string;
  chain_id?: number;
  token?: string;
  decimals?: number;
  pay_to?: string;
}

export function chainFromNetworkId(net?: string): Chain | null {
  if (!net) return null;
  if (net === 'eip155:8453' || net === 'eip155:84532') return 'base';
  if (net.startsWith('solana:')) return 'solana';
  if (net === 'eip155:4217' || net === 'eip155:42431') return 'tempo';
  return null;
}

export function parseBody(body: unknown, headers?: Headers): ParsedRails {
  const supported: RailQuote[] = [];
  const unsupported: UnsupportedRail[] = [];
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};

  if (Array.isArray(record.accepts)) {
    for (const a of record.accepts as X402Accept[]) {
      const chain = chainFromNetworkId(a.network);
      if (!chain) {
        unsupported.push({
          protocol: 'x402',
          scheme: a.scheme,
          network: a.network,
          asset: a.asset,
          pay_to: a.payTo,
          price_raw: a.maxAmountRequired,
          hint: lookupRailHint({ network: a.network, scheme: a.scheme }),
        });
        continue;
      }
      const decimals = a.extra?.decimals ?? 6;
      const priceRaw = a.maxAmountRequired ?? '0';
      const parsed = safeBigInt(priceRaw);
      const priceUsd = parsed === null ? undefined : Number(parsed) / 10 ** decimals;
      supported.push({
        chain,
        price_usd: priceUsd,
        decimals,
        price_raw: priceRaw,
        asset: a.asset,
        pay_to: a.payTo,
        protocol: 'x402',
      });
    }
  }

  if (Array.isArray(record.accepted_methods)) {
    const amountUsd = Number((record.amount_usd as string | undefined) ?? '0');
    for (const m of record.accepted_methods as MppAccept[]) {
      let chain: Chain | null = null;
      if (m.method?.startsWith('tempo/')) chain = 'tempo';
      else chain = chainFromNetworkId(m.network);
      if (!chain) {
        unsupported.push({
          protocol: 'mpp',
          method: m.method,
          network: m.network,
          asset: m.token,
          pay_to: m.pay_to,
          hint: lookupRailHint({ method: m.method, network: m.network }),
        });
        continue;
      }
      supported.push({
        chain,
        price_usd: Number.isFinite(amountUsd) && amountUsd > 0 ? amountUsd : undefined,
        decimals: m.decimals ?? 6,
        asset: m.token,
        pay_to: m.pay_to,
        protocol: 'mpp',
      });
    }
  }

  if (headers) {
    for (const c of parsePaymentChallenges(headers)) {
      const r = challengeToRail(c);
      const chain = chainFromMethodOrNetwork(r.scheme, r.network);
      if (!chain) {
        unsupported.push({
          protocol: 'mpp',
          method: r.scheme,
          network: r.network,
          asset: r.asset,
          pay_to: r.pay_to,
          price_raw: r.price_raw,
          hint: r.hint,
        });
        continue;
      }
      const priceUsdNum = r.price_usd !== undefined ? Number(r.price_usd) : undefined;
      supported.push({
        chain,
        price_usd: priceUsdNum !== undefined && Number.isFinite(priceUsdNum) ? priceUsdNum : undefined,
        decimals: 6,
        price_raw: r.price_raw,
        asset: r.asset,
        pay_to: r.pay_to,
        protocol: 'mpp',
      });
    }
  }

  return { supported, unsupported };
}

function chainFromMethodOrNetwork(method?: string, network?: string): Chain | null {
  if (method && /^tempo(\/|$)/i.test(method)) return 'tempo';
  return chainFromNetworkId(network);
}
