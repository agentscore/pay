import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createOnrampSession, getOnrampQuote, OnrampApiError } from '../src/onramp';
import { savePassport, type Passport } from '../src/passport/storage';

function makePassport(overrides: Partial<Passport> = {}): Passport {
  return {
    version: 1,
    operator_token: 'opc_test_token',
    expires_at: Date.now() + 24 * 60 * 60 * 1000,
    saved_at: Date.now(),
    ...overrides,
  };
}

interface MockReq {
  url: string;
  body: string;
  headers: Record<string, string>;
}

function makeFetch(
  status: number,
  body: unknown,
  capture: MockReq[],
): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    capture.push({
      url,
      body: typeof init?.body === 'string' ? init.body : '',
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as typeof globalThis.fetch;
}

describe('onramp.ts — getOnrampQuote', () => {
  it('POSTs to /v1/onramp/quotes with X-Client-Id, no passport needed', async () => {
    const reqs: MockReq[] = [];
    const fetchImpl = makeFetch(200, {
      chain: 'base',
      source_amount: '25.00',
      source_currency: 'usd',
      destination_amount: '22.40',
      destination_currency: 'usdc',
      destination_network: 'base',
      source_total_amount: '27.60',
      network_fee_monetary: '0.20',
      transaction_fee_monetary: '2.40',
      rate_fetched_at: 1.79e9,
    }, reqs);
    const quote = await getOnrampQuote({
      chain: 'base',
      amountUsd: 25,
      baseUrl: 'https://api.test',
      fetch: fetchImpl,
    });
    expect(reqs).toHaveLength(1);
    expect(reqs[0].url).toBe('https://api.test/v1/onramp/quotes');
    expect((reqs[0].headers as Record<string, string>)['X-Client-Id']).toBe('agentscore_pay_pubclient_v1');
    expect(JSON.parse(reqs[0].body)).toEqual({ chain: 'base', amount_usd: 25 });
    expect(quote.destination_amount).toBe('22.40');
    expect(quote.network_fee_monetary).toBe('0.20');
  });

  it('throws OnrampApiError on 4xx with parsed code', async () => {
    const fetchImpl = makeFetch(400, { error: { code: 'invalid_chain', message: 'bad chain' } }, []);
    await expect(getOnrampQuote({ chain: 'base', amountUsd: 25, baseUrl: 'https://api.test', fetch: fetchImpl }))
      .rejects.toMatchObject({ code: 'invalid_chain', status: 400 });
  });

  it('passes destination_amount when supplied', async () => {
    const reqs: MockReq[] = [];
    const fetchImpl = makeFetch(200, {
      chain: 'solana',
      source_amount: '53.20',
      source_currency: 'usd',
      destination_amount: '50.00',
      destination_currency: 'usdc',
      destination_network: 'solana',
      source_total_amount: '53.20',
      network_fee_monetary: '0.10',
      transaction_fee_monetary: '3.10',
      rate_fetched_at: 1.79e9,
    }, reqs);
    await getOnrampQuote({
      chain: 'solana',
      destinationAmount: 50,
      baseUrl: 'https://api.test',
      fetch: fetchImpl,
    });
    expect(JSON.parse(reqs[0].body)).toEqual({ chain: 'solana', destination_amount: 50 });
  });
});

describe('onramp.ts — createOnrampSession', () => {
  let tmp: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pay-onramp-'));
    prevHome = process.env.AGENTSCORE_PAY_HOME;
    process.env.AGENTSCORE_PAY_HOME = tmp;
  });
  afterEach(async () => {
    if (prevHome === undefined) delete process.env.AGENTSCORE_PAY_HOME;
    else process.env.AGENTSCORE_PAY_HOME = prevHome;
    await rm(tmp, { recursive: true, force: true });
  });

  it('throws passport_login_required when no passport is stored', async () => {
    await expect(createOnrampSession({
      walletAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      chain: 'base',
      amountUsd: 25,
      baseUrl: 'https://api.test',
      fetch: makeFetch(200, {}, []),
    })).rejects.toBeInstanceOf(OnrampApiError);
  });

  it('POSTs operator_token + wallet_address + amount_usd, returns parsed session', async () => {
    await savePassport(makePassport({ operator_token: 'opc_smoke_42' }));
    const reqs: MockReq[] = [];
    const fetchImpl = makeFetch(201, {
      session_id: 'cos_test',
      hosted_url: 'https://crypto.link.com?session_hash=abc',
      wallet_address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      chain: 'base',
      network: 'base',
      destination_currency: 'usdc',
      locked: true,
    }, reqs);
    const session = await createOnrampSession({
      walletAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      chain: 'base',
      amountUsd: 25,
      baseUrl: 'https://api.test',
      fetch: fetchImpl,
    });
    expect(session.session_id).toBe('cos_test');
    expect(session.hosted_url).toContain('crypto.link.com');
    const sent = JSON.parse(reqs[0].body) as Record<string, unknown>;
    expect(sent.operator_token).toBe('opc_smoke_42');
    expect(sent.wallet_address).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
    expect(sent.chain).toBe('base');
    expect(sent.amount_usd).toBe(25);
  });

  it('forwards destination_amount when supplied', async () => {
    await savePassport(makePassport());
    const reqs: MockReq[] = [];
    const fetchImpl = makeFetch(201, {
      session_id: 'cos_test',
      hosted_url: 'https://crypto.link.com?x=y',
      wallet_address: '0xabc',
      chain: 'base',
      network: 'base',
      destination_currency: 'usdc',
      locked: true,
    }, reqs);
    await createOnrampSession({
      walletAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      chain: 'base',
      destinationAmount: 50,
      baseUrl: 'https://api.test',
      fetch: fetchImpl,
    });
    const sent = JSON.parse(reqs[0].body) as Record<string, unknown>;
    expect(sent.destination_amount).toBe(50);
    expect(sent.amount_usd).toBeUndefined();
  });

  it('propagates region_not_supported with agent_instructions', async () => {
    await savePassport(makePassport());
    const fetchImpl = makeFetch(403, {
      error: {
        code: 'region_not_supported',
        message: 'Not available here.',
        agent_instructions: { action: 'use_alternative_funding_method', steps: ['use external wallet'] },
      },
    }, []);
    try {
      await createOnrampSession({
        walletAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        chain: 'base',
        amountUsd: 25,
        baseUrl: 'https://api.test',
        fetch: fetchImpl,
      });
      expect.fail('expected OnrampApiError');
    } catch (err) {
      expect(err).toBeInstanceOf(OnrampApiError);
      const apiErr = err as OnrampApiError;
      expect(apiErr.code).toBe('region_not_supported');
      expect(apiErr.status).toBe(403);
      expect(apiErr.agentInstructions?.action).toBe('use_alternative_funding_method');
    }
  });
});
