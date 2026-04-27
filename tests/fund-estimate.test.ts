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
  it('returns empty supported + unsupported for non-objects', () => {
    expect(parseBody(null)).toEqual({ supported: [], unsupported: [] });
    expect(parseBody('string')).toEqual({ supported: [], unsupported: [] });
    expect(parseBody(undefined)).toEqual({ supported: [], unsupported: [] });
  });

  it('parses x402 v1 accepts array (maxAmountRequired field)', () => {
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
    const { supported, unsupported } = parseBody(body);
    expect(supported).toHaveLength(1);
    expect(unsupported).toHaveLength(0);
    expect(supported[0]).toMatchObject({
      chain: 'base',
      price_usd: 5,
      decimals: 6,
      price_raw: '5000000',
      protocol: 'x402',
      pay_to: '0xAbC1',
    });
  });

  it('parses x402 v2 accepts array (amount field) — the shape modern merchants emit', () => {
    const body = {
      accepts: [
        {
          scheme: 'exact',
          network: 'eip155:84532',
          amount: '110000',
          asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
          payTo: '0xAbC1',
          extra: { name: 'USDC', version: '2' },
        },
      ],
    };
    const { supported } = parseBody(body);
    expect(supported).toHaveLength(1);
    expect(supported[0]).toMatchObject({
      chain: 'base',
      price_usd: 0.11,
      decimals: 6,
      price_raw: '110000',
      protocol: 'x402',
    });
  });

  it('leaves price_usd undefined when decimals is omitted and asset is unknown (refuses to guess)', () => {
    const body = {
      accepts: [
        {
          scheme: 'exact',
          network: 'eip155:8453',
          amount: '1000000000000000000',
          asset: '0x0000000000000000000000000000000000000bAd',
          payTo: '0xAbC1',
        },
      ],
    };
    const { supported } = parseBody(body);
    expect(supported).toHaveLength(1);
    expect(supported[0].price_usd).toBeUndefined();
    expect(supported[0].decimals).toBeUndefined();
    expect(supported[0].price_raw).toBe('1000000000000000000');
  });

  it('parses MPP accepted_methods array with amount_usd', () => {
    const body = {
      amount_usd: '12.50',
      accepted_methods: [
        { method: 'tempo/charge', network: 'eip155:4217', chain_id: 4217, token: '0x20C0', decimals: 6, pay_to: '0xABC2' },
      ],
    };
    const { supported } = parseBody(body);
    expect(supported).toHaveLength(1);
    expect(supported[0]).toMatchObject({ chain: 'tempo', price_usd: 12.5, protocol: 'mpp', pay_to: '0xABC2' });
  });

  it('handles a merchant that advertises both x402 + MPP (like martin-estate)', () => {
    const body = {
      amount_usd: '250',
      accepts: [
        { scheme: 'exact', network: 'eip155:8453', maxAmountRequired: '250000000', asset: '0x833589', payTo: '0x1', extra: { decimals: 6 } },
      ],
      accepted_methods: [{ method: 'tempo/charge', chain_id: 4217, token: '0x20C0', decimals: 6, pay_to: '0x2' }],
    };
    const { supported } = parseBody(body);
    expect(supported).toHaveLength(2);
    expect(supported.map((q) => q.chain).sort()).toEqual(['base', 'tempo']);
    expect(supported.map((q) => q.protocol).sort()).toEqual(['mpp', 'x402']);
  });

  it('surfaces unsupported x402 rails with hints when known', () => {
    const body = {
      accepts: [{ scheme: 'exact', network: 'eip155:137', maxAmountRequired: '100' }],
    };
    const { supported, unsupported } = parseBody(body);
    expect(supported).toEqual([]);
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0]).toMatchObject({ protocol: 'x402', network: 'eip155:137' });
    expect(unsupported[0].hint?.name).toContain('Polygon');
  });

  it('surfaces unsupported MPP methods with hints (stripe → link-cli)', () => {
    const body = {
      accepted_methods: [{ method: 'stripe', token: 'usd', pay_to: 'pi_x' }],
    };
    const { supported, unsupported } = parseBody(body);
    expect(supported).toEqual([]);
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0].hint?.recommended_client?.name).toBe('@stripe/link-cli');
  });

  it('mixes supported + unsupported in the same response', () => {
    const body = {
      accepts: [
        { scheme: 'exact', network: 'eip155:8453', maxAmountRequired: '1000', extra: { decimals: 6 } },
        { scheme: 'exact', network: 'eip155:1', maxAmountRequired: '1000', extra: { decimals: 6 } },
      ],
    };
    const { supported, unsupported } = parseBody(body);
    expect(supported).toHaveLength(1);
    expect(unsupported).toHaveLength(1);
    expect(supported[0].chain).toBe('base');
    expect(unsupported[0].network).toBe('eip155:1');
  });

  describe('with WWW-Authenticate headers (paymentauth.org spec)', () => {
    // Locus apollo/org-enrichment style 402: bare problem+json body, the rail
    // metadata lives in WWW-Authenticate. Without the headers arg, parseBody
    // returns no rails; with headers it surfaces the tempo rail.
    const LOCUS_HEADER =
      'Payment id="abc", realm="apollo.mpp.paywithlocus.com", method="tempo", intent="charge", request="eyJhbW91bnQiOiI4MDAwIiwiY3VycmVuY3kiOiIweDIwQzAwMDAwMDAwMDAwMDAwMDAwMDAwMGI5NTM3ZDExYzYwRThiNTAiLCJtZXRob2REZXRhaWxzIjp7ImNoYWluSWQiOjQyMTd9LCJyZWNpcGllbnQiOiIweDA2MGIwZkIwQmU5ZDkwNTU3NTc3QjNBRUU0ODA3MTEwNjcxNDlGZjAifQ"';

    it('extracts MPP rail from WWW-Authenticate when body has no accepts/accepted_methods', () => {
      const body = { type: 'https://paymentauth.org/problems/payment-required', status: 402 };
      const headers = new Headers({ 'www-authenticate': LOCUS_HEADER });
      const { supported, unsupported } = parseBody(body, headers);
      expect(unsupported).toHaveLength(0);
      expect(supported).toHaveLength(1);
      expect(supported[0]).toMatchObject({
        chain: 'tempo',
        protocol: 'mpp',
        price_usd: 0.008,
        price_raw: '8000',
        pay_to: '0x060b0fB0Be9d90557577B3AEE480711067149Ff0',
      });
    });

    it('returns no rails when headers are not passed (the bug we fixed)', () => {
      const body = { type: 'https://paymentauth.org/problems/payment-required', status: 402 };
      const { supported, unsupported } = parseBody(body);
      expect(supported).toEqual([]);
      expect(unsupported).toEqual([]);
    });

    it('flags unsupported challenge schemes as unsupported (e.g. stripe)', () => {
      const headers = new Headers({
        'www-authenticate': 'Payment id="x", realm="m.com", method="stripe", request="e30="',
      });
      const { supported, unsupported } = parseBody({}, headers);
      expect(supported).toEqual([]);
      expect(unsupported).toHaveLength(1);
      expect(unsupported[0].method).toBe('stripe');
    });

    it('merges body-derived rails with header-derived rails', () => {
      const body = {
        accepts: [
          { scheme: 'exact', network: 'eip155:8453', maxAmountRequired: '1000', extra: { decimals: 6 } },
        ],
      };
      const headers = new Headers({ 'www-authenticate': LOCUS_HEADER });
      const { supported } = parseBody(body, headers);
      expect(supported).toHaveLength(2);
      expect(supported.map((q) => q.chain).sort()).toEqual(['base', 'tempo']);
    });
  });
});
