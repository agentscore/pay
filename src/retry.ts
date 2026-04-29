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
  if (TRANSIENT_NETWORK_ERR_PATTERN.test(err.message)) return true;
  // Node 20+ wraps the underlying ECONNRESET / ETIMEDOUT in `cause` of a
  // generic TypeError("fetch failed"). Walk the chain.
  const cause = (err as Error & { cause?: unknown }).cause;
  if (cause instanceof Error && cause !== err) return isTransientNetworkError(cause);
  return false;
}

export async function withRetries<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  // jitter defaults to Math.random() in production to spread retries (avoid thundering herd);
  // tests pass `() => 0` for deterministic delays.
  const { retries, baseDelayMs = 200, maxDelayMs = 10_000, jitter = () => Math.random() } = opts;
  if (retries < 0) throw new Error('retries must be >= 0');
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
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
