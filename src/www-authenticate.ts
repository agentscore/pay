import { chainFromNetworkId } from './quotes';
import { lookupRailHint, type RailHint } from './rail-hints';
import type { Chain } from './constants';

export interface PaymentRequestBlob {
  amount?: string;
  currency?: string;
  methodDetails?: { chainId?: number; network?: string };
  recipient?: string;
  [key: string]: unknown;
}

export interface PaymentChallenge {
  id?: string;
  realm?: string;
  method?: string;
  intent?: string;
  expires?: string;
  request?: PaymentRequestBlob;
  request_raw?: string;
}

export interface ChallengeRail {
  protocol: 'mpp';
  rail: string;
  scheme: string;
  network?: string;
  price_raw?: string;
  price_usd?: string;
  asset?: string;
  pay_to?: string;
  natively_supported: boolean;
  hint?: RailHint;
  challenge_id?: string;
  realm?: string;
  expires?: string;
}

const PARAM_RE = /([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*"((?:\\.|[^"\\])*)"/g;

export function parsePaymentChallenges(headers: Headers): PaymentChallenge[] {
  const raw = headers.get('www-authenticate');
  if (!raw) return [];

  const segments = splitChallenges(raw);
  const challenges: PaymentChallenge[] = [];
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!/^payment(\s|$)/i.test(trimmed)) continue;
    const paramStr = trimmed.replace(/^payment\s*/i, '');
    const params = parseParams(paramStr);
    const requestRaw = params.get('request');
    challenges.push({
      id: params.get('id'),
      realm: params.get('realm'),
      method: params.get('method'),
      intent: params.get('intent'),
      expires: params.get('expires'),
      request_raw: requestRaw,
      request: requestRaw ? decodeRequest(requestRaw) : undefined,
    });
  }
  return challenges;
}

export function challengeToRail(c: PaymentChallenge): ChallengeRail {
  const method = c.method ?? 'unknown';
  const md = c.request?.methodDetails;
  const network = md?.chainId !== undefined ? `eip155:${md.chainId}` : md?.network;
  let chain: Chain | null = null;
  if (/^tempo(\/|$)/i.test(method)) chain = 'tempo';
  else if (network) chain = chainFromNetworkId(network);

  const priceRaw = c.request?.amount;
  const decimals = 6;
  let priceUsd: string | undefined;
  if (priceRaw !== undefined) {
    try {
      priceUsd = (Number(BigInt(priceRaw)) / 10 ** decimals).toFixed(decimals);
    } catch {
      priceUsd = undefined;
    }
  }

  const naturallySupported = chain !== null;
  return {
    protocol: 'mpp',
    rail: method,
    scheme: method,
    network,
    price_raw: priceRaw,
    price_usd: priceUsd,
    asset: c.request?.currency,
    pay_to: c.request?.recipient,
    natively_supported: naturallySupported,
    hint: naturallySupported ? undefined : lookupRailHint({ method, network }),
    challenge_id: c.id,
    realm: c.realm,
    expires: c.expires,
  };
}

function splitChallenges(raw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let inQuote = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"' && raw[i - 1] !== '\\') {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) continue;
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch !== ',' || depth !== 0) continue;
    const candidate = raw.slice(start, i);
    if (looksLikeChallengeBoundary(raw, i)) {
      out.push(candidate);
      start = i + 1;
    }
  }
  out.push(raw.slice(start));
  return out;
}

function looksLikeChallengeBoundary(raw: string, commaIdx: number): boolean {
  const after = raw.slice(commaIdx + 1).trimStart();
  return /^[A-Za-z][A-Za-z0-9-]*\s/.test(after) && !/^[a-zA-Z][a-zA-Z0-9_-]*\s*=/.test(after);
}

function parseParams(s: string): Map<string, string> {
  const params = new Map<string, string>();
  PARAM_RE.lastIndex = 0;
  let m;
  while ((m = PARAM_RE.exec(s)) !== null) {
    params.set(m[1], unescapeQuoted(m[2]));
  }
  return params;
}

function unescapeQuoted(v: string): string {
  return v.replace(/\\(.)/g, '$1');
}

function decodeRequest(b64: string): PaymentRequestBlob | undefined {
  try {
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(json) as PaymentRequestBlob;
  } catch {
    return undefined;
  }
}
