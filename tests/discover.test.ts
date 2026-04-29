import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sampleBazaar = {
  items: [
    {
      description: 'Exa /search endpoint',
      accepts: [{
        scheme: 'exact',
        network: 'eip155:8453',
        amount: '7000',
        asset: '0xUSDC',
        payTo: '0xpay',
        extra: { decimals: 6, totalUsd: 0.007, name: 'USDC' },
      }],
      extensions: { agentkit: { info: { uri: 'https://api.exa.ai/search', domain: 'api.exa.ai' } } },
    },
    {
      description: 'A pricier solana service',
      accepts: [{
        scheme: 'exact',
        network: 'solana:abc',
        amount: '1000000',
        extra: { decimals: 6, totalUsd: 1.0 },
      }],
      extensions: { agentkit: { info: { uri: 'https://other.example/api', domain: 'other.example' } } },
    },
  ],
};

describe('discover', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetModules();
  });

  it('lists all services', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => sampleBazaar,
    } as Response);
    const { discover } = await import('../src/commands/discover');
    const result = await discover({});
    expect(result.count).toBe(2);
    expect(result.services[0].url).toBe('https://api.exa.ai/search');
    expect(result.services[0].cheapest_usd).toBeCloseTo(0.007);
  });

  it('filters by chain', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => sampleBazaar,
    } as Response);
    const { discover } = await import('../src/commands/discover');
    const result = await discover({ chain: 'base' });
    expect(result.count).toBe(1);
    expect(result.services[0].domain).toBe('api.exa.ai');
  });

  it('filters by maxPriceUsd', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => sampleBazaar,
    } as Response);
    const { discover } = await import('../src/commands/discover');
    const result = await discover({ maxPriceUsd: 0.5 });
    expect(result.count).toBe(1);
    expect(result.services[0].domain).toBe('api.exa.ai');
  });

  it('filters by search substring (case-insensitive)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => sampleBazaar,
    } as Response);
    const { discover } = await import('../src/commands/discover');
    const result = await discover({ search: 'PRICIER' });
    expect(result.count).toBe(1);
    expect(result.services[0].domain).toBe('other.example');
  });

  it('throws network_error on non-2xx', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' } as Response);
    const { discover } = await import('../src/commands/discover');
    await expect(discover({})).rejects.toMatchObject({ code: 'network_error' });
  });

  it('throws network_error when fetch throws', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const { discover } = await import('../src/commands/discover');
    await expect(discover({})).rejects.toMatchObject({ code: 'network_error' });
  });
});
