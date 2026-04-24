import { describe, expect, it } from 'vitest';
import { chainFromNetworkId, parseBody } from '../src/quotes';

describe('chainFromNetworkId', () => {
  it('maps eip155:8453 → base', () => {
    expect(chainFromNetworkId('eip155:8453')).toBe('base');
  });

  it('maps eip155:84532 → base (sepolia)', () => {
    expect(chainFromNetworkId('eip155:84532')).toBe('base');
  });

  it('maps solana:* → solana', () => {
    expect(chainFromNetworkId('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')).toBe('solana');
    expect(chainFromNetworkId('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1')).toBe('solana');
  });

  it('maps tempo chain IDs → tempo', () => {
    expect(chainFromNetworkId('eip155:4217')).toBe('tempo');
    expect(chainFromNetworkId('eip155:42431')).toBe('tempo');
  });

  it('returns null for unknown networks', () => {
    expect(chainFromNetworkId('eip155:1')).toBeNull();
    expect(chainFromNetworkId('eip155:137')).toBeNull();
    expect(chainFromNetworkId(undefined)).toBeNull();
  });
});

describe('parseBody', () => {
  it('returns empty for non-objects', () => {
    expect(parseBody(null)).toEqual([]);
    expect(parseBody('string')).toEqual([]);
    expect(parseBody(undefined)).toEqual([]);
  });

  it('parses x402 accepts array', () => {
    const body = {
      accepts: [
        {
          scheme: 'exact',
          network: 'eip155:8453',
          maxAmountRequired: '5000000',
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          payTo: '0xAbC1',
          extra: { decimals: 6 },
        },
      ],
    };
    const quotes = parseBody(body);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({
      chain: 'base',
      price_usd: 5,
      decimals: 6,
      price_raw: '5000000',
      protocol: 'x402',
      pay_to: '0xAbC1',
    });
  });

  it('parses MPP accepted_methods array with amount_usd', () => {
    const body = {
      amount_usd: '12.50',
      accepted_methods: [
        { method: 'tempo/charge', network: 'eip155:4217', chain_id: 4217, token: '0x20C0', decimals: 6, pay_to: '0xABC2' },
      ],
    };
    const quotes = parseBody(body);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ chain: 'tempo', price_usd: 12.5, protocol: 'mpp', pay_to: '0xABC2' });
  });

  it('handles a merchant that advertises both x402 + MPP (like martin-estate)', () => {
    const body = {
      amount_usd: '250',
      accepts: [
        { scheme: 'exact', network: 'eip155:8453', maxAmountRequired: '250000000', asset: '0x833589', payTo: '0x1', extra: { decimals: 6 } },
      ],
      accepted_methods: [{ method: 'tempo/charge', chain_id: 4217, token: '0x20C0', decimals: 6, pay_to: '0x2' }],
    };
    const quotes = parseBody(body);
    expect(quotes).toHaveLength(2);
    expect(quotes.map((q) => q.chain).sort()).toEqual(['base', 'tempo']);
    expect(quotes.map((q) => q.protocol).sort()).toEqual(['mpp', 'x402']);
  });

  it('skips rails on unknown networks', () => {
    const body = {
      accepts: [{ scheme: 'exact', network: 'eip155:1', maxAmountRequired: '100' }],
    };
    expect(parseBody(body)).toEqual([]);
  });
});
