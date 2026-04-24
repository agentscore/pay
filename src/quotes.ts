import type { Chain } from './constants';

export interface RailQuote {
  chain: Chain;
  price_usd?: number;
  decimals?: number;
  price_raw?: string;
  asset?: string;
  pay_to?: string;
  protocol: 'x402' | 'mpp';
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

export function parseBody(body: unknown): RailQuote[] {
  if (!body || typeof body !== 'object') return [];
  const record = body as Record<string, unknown>;
  const quotes: RailQuote[] = [];

  if (Array.isArray(record.accepts)) {
    for (const a of record.accepts as X402Accept[]) {
      const chain = chainFromNetworkId(a.network);
      if (!chain) continue;
      const decimals = a.extra?.decimals ?? 6;
      const priceRaw = a.maxAmountRequired ?? '0';
      const priceUsd = Number(BigInt(priceRaw)) / 10 ** decimals;
      quotes.push({
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
      if (!chain) continue;
      quotes.push({
        chain,
        price_usd: Number.isFinite(amountUsd) && amountUsd > 0 ? amountUsd : undefined,
        decimals: m.decimals ?? 6,
        asset: m.token,
        pay_to: m.pay_to,
        protocol: 'mpp',
      });
    }
  }

  return quotes;
}
