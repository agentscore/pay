import { setTimeout as sleep } from 'timers/promises';
import { CliError } from './errors';

const TRANSIENT_NETWORK_ERR_PATTERN = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|fetch failed|network error|socket hang up/i;

export interface RetryOptions {
  retries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: () => number;
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
}

export function isTransientNetworkError(err: unknown): boolean {
  if (err instanceof CliError) return false;
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError') return false;
  return TRANSIENT_NETWORK_ERR_PATTERN.test(err.message);
}

export async function withRetries<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const { retries, baseDelayMs = 200, maxDelayMs = 10_000, jitter = () => Math.random() } = opts;
  if (retries < 0) throw new Error('retries must be >= 0');
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientNetworkError(err) || attempt === retries) throw err;
      const exp = baseDelayMs * 2 ** attempt;
      const delayMs = Math.min(exp + Math.floor(jitter() * baseDelayMs), maxDelayMs);
      opts.onRetry?.(attempt + 1, err, delayMs);
      await sleep(delayMs);
    }
  }
  throw lastErr;
}
