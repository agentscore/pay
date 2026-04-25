import { describe, expect, it, vi } from 'vitest';
import { CliError } from '../src/errors';
import { isTransientNetworkError, withRetries } from '../src/retry';

describe('isTransientNetworkError', () => {
  it('classifies ECONNRESET as transient', () => {
    expect(isTransientNetworkError(new Error('socket: ECONNRESET'))).toBe(true);
  });
  it('classifies ECONNREFUSED as transient', () => {
    expect(isTransientNetworkError(new Error('connect ECONNREFUSED 127.0.0.1:443'))).toBe(true);
  });
  it('classifies "fetch failed" as transient', () => {
    expect(isTransientNetworkError(new Error('fetch failed'))).toBe(true);
  });
  it('does not retry CliError (intentional failures)', () => {
    expect(isTransientNetworkError(new CliError('rpc_error', 'rate limited'))).toBe(false);
  });
  it('does not retry AbortError (user/timeout-initiated)', () => {
    const e = new Error('aborted');
    e.name = 'AbortError';
    expect(isTransientNetworkError(e)).toBe(false);
  });
  it('does not retry generic 4xx-style messages', () => {
    expect(isTransientNetworkError(new Error('Bad Request'))).toBe(false);
  });

  it('walks Error.cause chain (Node 20+ fetch wraps ECONNRESET in TypeError)', () => {
    const inner = new Error('ECONNRESET');
    const outer = new TypeError('fetch failed') as Error & { cause: unknown };
    outer.cause = inner;
    expect(isTransientNetworkError(outer)).toBe(true);
  });

  it('returns false when cause is non-transient', () => {
    const inner = new Error('Permission denied');
    const outer = new Error('outer') as Error & { cause: unknown };
    outer.cause = inner;
    expect(isTransientNetworkError(outer)).toBe(false);
  });

  it('does not infinitely loop when cause is self-reference', () => {
    const e = new Error('whatever') as Error & { cause: unknown };
    e.cause = e;
    expect(isTransientNetworkError(e)).toBe(false);
  });
});

describe('withRetries', () => {
  it('returns immediately on success', async () => {
    const fn = vi.fn(async () => 'ok');
    const result = await withRetries(fn, { retries: 3, baseDelayMs: 1, jitter: () => 0 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('retries up to N on transient errors then succeeds', async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      if (calls < 3) throw new Error('ECONNRESET');
      return 'recovered';
    };
    const result = await withRetries(fn, { retries: 3, baseDelayMs: 1, jitter: () => 0 });
    expect(result).toBe('recovered');
    expect(calls).toBe(3);
  });

  it('throws after exhausting retries', async () => {
    const fn = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    await expect(withRetries(fn, { retries: 2, baseDelayMs: 1, jitter: () => 0 })).rejects.toThrow('ECONNRESET');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-transient errors', async () => {
    const fn = vi.fn(async () => {
      throw new CliError('max_spend_exceeded', 'too expensive');
    });
    await expect(withRetries(fn, { retries: 5, baseDelayMs: 1, jitter: () => 0 })).rejects.toBeInstanceOf(CliError);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('invokes onRetry callback per attempt', async () => {
    const onRetry = vi.fn();
    let calls = 0;
    const fn = async () => {
      calls += 1;
      if (calls < 2) throw new Error('ECONNRESET');
      return 'ok';
    };
    await withRetries(fn, { retries: 3, baseDelayMs: 1, jitter: () => 0, onRetry });
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRetry.mock.calls[0][0]).toBe(1);
  });

  it('rejects negative retries argument', async () => {
    await expect(withRetries(async () => 'x', { retries: -1, baseDelayMs: 1 })).rejects.toThrow();
  });

  it('caps backoff at maxDelayMs', async () => {
    let calls = 0;
    const onRetry = vi.fn();
    const fn = async () => {
      calls += 1;
      if (calls < 5) throw new Error('ECONNRESET');
      return 'ok';
    };
    await withRetries(fn, { retries: 5, baseDelayMs: 1, maxDelayMs: 5, jitter: () => 0, onRetry });
    for (const call of onRetry.mock.calls) {
      expect(call[2]).toBeLessThanOrEqual(5);
    }
  });
});
