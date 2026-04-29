import { describe, expect, it } from 'vitest';
import { lookupRailHint } from '../src/rail-hints';

describe('lookupRailHint', () => {
  it('returns hint for known unsupported network', () => {
    const hint = lookupRailHint({ network: 'eip155:137' });
    expect(hint?.name).toContain('Polygon');
  });

  it('returns hint for stripe method', () => {
    const hint = lookupRailHint({ method: 'stripe' });
    expect(hint?.name).toContain('Stripe');
    expect(hint?.recommended_client?.name).toBe('@stripe/link-cli');
  });

  it('returns hint for stripe-spt method', () => {
    const hint = lookupRailHint({ method: 'stripe-spt' });
    expect(hint?.recommended_client?.name).toBe('@stripe/link-cli');
  });

  it('returns hint for stripe-prefixed methods', () => {
    const hint = lookupRailHint({ method: 'stripe/exact' });
    expect(hint?.name).toContain('Stripe');
  });

  it('returns undefined for completely unknown rail', () => {
    expect(lookupRailHint({ network: 'eip155:99999' })).toBeUndefined();
    expect(lookupRailHint({ method: 'paypal' })).toBeUndefined();
  });

  it('prefers network match over method match', () => {
    const hint = lookupRailHint({ network: 'eip155:1', method: 'stripe' });
    expect(hint?.name).toContain('Ethereum');
  });

  it('returns undefined when called with no fields', () => {
    expect(lookupRailHint({})).toBeUndefined();
  });
});
