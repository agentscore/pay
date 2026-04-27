import { describe, expect, it } from 'vitest';
import { mergeHeaders } from '../src/headers';

describe('mergeHeaders', () => {
  it('returns defaults when user provides nothing', () => {
    expect(mergeHeaders({ 'Content-Type': 'application/json' })).toEqual({
      'Content-Type': 'application/json',
    });
  });

  it('merges non-overlapping user headers on top of defaults', () => {
    expect(
      mergeHeaders({ 'Content-Type': 'application/json' }, { 'X-Custom': 'abc' }),
    ).toEqual({ 'Content-Type': 'application/json', 'X-Custom': 'abc' });
  });

  it('user header overrides default with same name (exact case)', () => {
    expect(
      mergeHeaders({ 'Content-Type': 'application/json' }, { 'Content-Type': 'text/plain' }),
    ).toEqual({ 'Content-Type': 'text/plain' });
  });

  it('user header overrides default case-insensitively (the bug we fixed)', () => {
    // Without case-insensitive merge, fetch would send `Content-Type: application/json, application/json`
    // and strict body-parsers (Express's, Locus Apollo's, etc.) reject the body as undefined.
    const result = mergeHeaders(
      { 'Content-Type': 'application/json' },
      { 'content-type': 'application/json' },
    );
    expect(Object.keys(result)).toHaveLength(1);
    expect(result['content-type']).toBe('application/json');
    expect(result['Content-Type']).toBeUndefined();
  });

  it('preserves user case when overriding (no normalization)', () => {
    const result = mergeHeaders(
      { 'X-Foo': 'a', 'X-Bar': 'b' },
      { 'x-foo': 'override', 'X-BAZ': 'new' },
    );
    expect(result).toEqual({ 'X-Bar': 'b', 'x-foo': 'override', 'X-BAZ': 'new' });
  });

  it('handles multiple defaults with multiple user overrides', () => {
    const result = mergeHeaders(
      { 'Content-Type': 'application/json', 'X-Wallet-Address': '0xabc', 'X-Idempotency-Key': 'k1' },
      { 'X-OPERATOR-TOKEN': 'opc_xxx', 'X-IDEMPOTENCY-KEY': 'user-supplied-key' },
    );
    // Content-Type kept (no override), X-Wallet-Address kept, X-Idempotency-Key OVERRIDDEN
    expect(result['Content-Type']).toBe('application/json');
    expect(result['X-Wallet-Address']).toBe('0xabc');
    expect(result['X-Idempotency-Key']).toBeUndefined();
    expect(result['X-IDEMPOTENCY-KEY']).toBe('user-supplied-key');
    expect(result['X-OPERATOR-TOKEN']).toBe('opc_xxx');
  });
});
