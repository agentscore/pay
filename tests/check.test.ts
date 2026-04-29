import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { check } from '../src/commands/check';

describe('check command', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns payment_required:false on a 200 response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: async () => '{"ok":true}',
    } as unknown as Response);
    const result = await check({ method: 'GET', url: 'https://m.example/x' });
    expect(result.payment_required).toBe(false);
    expect(result.status).toBe(200);
  });

  it('parses x402 v2 accepts on a 402 response', async () => {
    const body = {
      x402Version: 2,
      accepts: [
        {
          scheme: 'exact',
          network: 'eip155:8453',
          amount: '5000',
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          payTo: '0xMerchant',
          extra: { name: 'USDC' },
        },
      ],
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 402,
      statusText: 'Payment Required',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify(body),
    } as unknown as Response);
    const result = await check({ method: 'POST', url: 'https://m.example/x' });
    expect(result.payment_required).toBe(true);
    expect(result.protocol).toBe('x402');
    expect(result.rails).toHaveLength(1);
    expect(result.rails![0]!.price_usd).toBe('0.005000');
  });

  it('throws network_error when fetch fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(check({ method: 'GET', url: 'https://m.example/x' })).rejects.toMatchObject({
      code: 'network_error',
    });
  });

  it('parses MPP accepted_methods on a 402', async () => {
    const body = {
      amount_usd: '0.01',
      accepted_methods: [{ method: 'tempo/charge', chain_id: 4217, token: '0x20C0', decimals: 6, pay_to: '0xMerchant' }],
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 402,
      statusText: 'Payment Required',
      headers: new Headers(),
      text: async () => JSON.stringify(body),
    } as unknown as Response);
    const result = await check({ method: 'POST', url: 'https://m.example/x' });
    expect(result.protocol).toBe('mpp');
    expect(result.rails![0]!.rail).toContain('tempo');
  });
});
