/**
 * Regression: pay must sign the RFC 9421 @path as the absolute path ONLY. Signing pathname+search
 * made proof-of-possession fail for every query-bearing URL, because the verifier (node-commerce
 * edge + core/api) reconstructs @path as pathname — the query is the separate @query component that
 * AIP's minimum covered set omits.
 */
import { describe, expect, it } from 'vitest';
import { requestDescriptor } from '../src/commands/pay';

describe('requestDescriptor — RFC 9421 @path', () => {
  it('excludes the query string from @path (uppercases method)', () => {
    expect(requestDescriptor('https://m.example/checkout?order=42&x=1', 'post')).toEqual({
      method: 'POST',
      authority: 'm.example',
      path: '/checkout',
    });
  });

  it('handles a query-less path unchanged', () => {
    expect(requestDescriptor('https://m.example/wines/pinot', 'GET').path).toBe('/wines/pinot');
  });

  it('keeps a non-default port in the authority but still drops the query', () => {
    expect(requestDescriptor('https://m.example:8443/x?q=1', 'GET')).toMatchObject({
      authority: 'm.example:8443',
      path: '/x',
    });
  });
});
