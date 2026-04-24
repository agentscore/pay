import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { readEntries } from './ledger';
import { limitsPath } from './paths';

export { limitsPath } from './paths';

export interface Limits {
  daily_usd?: number;
  per_call_usd?: number;
  per_merchant_usd?: number;
}

export async function loadLimits(): Promise<Limits> {
  try {
    const raw = await readFile(limitsPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      daily_usd: numericOrUndefined(parsed.daily_usd),
      per_call_usd: numericOrUndefined(parsed.per_call_usd),
      per_merchant_usd: numericOrUndefined(parsed.per_merchant_usd),
    };
  } catch (err) {
    if (isNotFound(err)) return {};
    throw err;
  }
}

export async function saveLimits(limits: Limits): Promise<void> {
  const path = limitsPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(limits, null, 2), { mode: 0o600 });
}

export async function clearLimits(): Promise<void> {
  try {
    await rm(limitsPath());
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
}

function numericOrUndefined(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return undefined;
  return v;
}

function isNotFound(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT');
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface EnforceInput {
  priceUsd: number;
  host: string;
  now?: Date;
}

export interface EnforceResult {
  allowed: boolean;
  violated?: 'per_call_usd' | 'daily_usd' | 'per_merchant_usd';
  limit?: number;
  would_be?: number;
}

export async function enforce(limits: Limits, input: EnforceInput): Promise<EnforceResult> {
  const { priceUsd, host } = input;
  const now = input.now ?? new Date();

  if (limits.per_call_usd !== undefined && priceUsd > limits.per_call_usd) {
    return { allowed: false, violated: 'per_call_usd', limit: limits.per_call_usd, would_be: priceUsd };
  }

  if (limits.daily_usd === undefined && limits.per_merchant_usd === undefined) {
    return { allowed: true };
  }

  const cutoff = now.getTime() - ONE_DAY_MS;
  const entries = await readEntries();
  let dailySum = 0;
  let merchantSum = 0;
  for (const entry of entries) {
    if (!entry.ok || !entry.price_usd) continue;
    const amount = Number(entry.price_usd);
    if (!Number.isFinite(amount)) continue;
    const ts = Date.parse(entry.timestamp);
    if (Number.isFinite(ts) && ts >= cutoff) dailySum += amount;
    if (entry.host === host) merchantSum += amount;
  }

  if (limits.daily_usd !== undefined && dailySum + priceUsd > limits.daily_usd) {
    return { allowed: false, violated: 'daily_usd', limit: limits.daily_usd, would_be: dailySum + priceUsd };
  }
  if (limits.per_merchant_usd !== undefined && merchantSum + priceUsd > limits.per_merchant_usd) {
    return { allowed: false, violated: 'per_merchant_usd', limit: limits.per_merchant_usd, would_be: merchantSum + priceUsd };
  }
  return { allowed: true };
}
