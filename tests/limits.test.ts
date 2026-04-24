import { mkdir, rm } from 'fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendEntry } from '../src/ledger';
import { clearLimits, enforce, loadLimits, saveLimits } from '../src/limits';

const ROOT = '/tmp/pay-cli-limits-test';

describe('limits', () => {
  let originalHome: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    process.env.HOME = ROOT;
    await rm(ROOT, { recursive: true, force: true });
    await mkdir(ROOT, { recursive: true });
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(ROOT, { recursive: true, force: true });
  });

  it('returns empty limits when file missing', async () => {
    expect(await loadLimits()).toEqual({});
  });

  it('round-trips saved limits', async () => {
    await saveLimits({ daily_usd: 100, per_call_usd: 5 });
    expect(await loadLimits()).toEqual({ daily_usd: 100, per_call_usd: 5, per_merchant_usd: undefined });
  });

  it('clearLimits removes the file', async () => {
    await saveLimits({ daily_usd: 10 });
    await clearLimits();
    expect(await loadLimits()).toEqual({});
  });

  it('enforce allows when no limits set', async () => {
    const result = await enforce({}, { priceUsd: 100, host: 'x.example' });
    expect(result.allowed).toBe(true);
  });

  it('enforce blocks per_call', async () => {
    const result = await enforce({ per_call_usd: 5 }, { priceUsd: 10, host: 'x.example' });
    expect(result.allowed).toBe(false);
    expect(result.violated).toBe('per_call_usd');
  });

  it('enforce blocks daily sum', async () => {
    const now = new Date('2026-04-24T12:00:00Z');
    await appendEntry({
      timestamp: '2026-04-24T10:00:00Z',
      chain: 'base',
      signer: '0x',
      method: 'POST',
      url: 'https://x/',
      host: 'x',
      status: 200,
      protocol: 'x402',
      price_usd: '80',
      ok: true,
    });
    const result = await enforce({ daily_usd: 100 }, { priceUsd: 30, host: 'y', now });
    expect(result.allowed).toBe(false);
    expect(result.violated).toBe('daily_usd');
    expect(result.would_be).toBe(110);
  });

  it('enforce ignores entries older than 24h', async () => {
    const now = new Date('2026-04-24T12:00:00Z');
    await appendEntry({
      timestamp: '2026-04-22T10:00:00Z',
      chain: 'base',
      signer: '0x',
      method: 'POST',
      url: 'https://x/',
      host: 'x',
      status: 200,
      protocol: 'x402',
      price_usd: '80',
      ok: true,
    });
    const result = await enforce({ daily_usd: 100 }, { priceUsd: 30, host: 'y', now });
    expect(result.allowed).toBe(true);
  });

  it('enforce blocks per_merchant by host', async () => {
    const now = new Date('2026-04-24T12:00:00Z');
    await appendEntry({
      timestamp: '2026-04-24T10:00:00Z',
      chain: 'base',
      signer: '0x',
      method: 'POST',
      url: 'https://a.example/',
      host: 'a.example',
      status: 200,
      protocol: 'x402',
      price_usd: '40',
      ok: true,
    });
    const result = await enforce({ per_merchant_usd: 50 }, { priceUsd: 30, host: 'a.example', now });
    expect(result.allowed).toBe(false);
    expect(result.violated).toBe('per_merchant_usd');
  });

  it('enforce does not count failed payments', async () => {
    const now = new Date('2026-04-24T12:00:00Z');
    await appendEntry({
      timestamp: '2026-04-24T10:00:00Z',
      chain: 'base',
      signer: '0x',
      method: 'POST',
      url: 'https://a.example/',
      host: 'a.example',
      status: 500,
      protocol: 'x402',
      price_usd: '80',
      ok: false,
    });
    const result = await enforce({ daily_usd: 100 }, { priceUsd: 30, host: 'a.example', now });
    expect(result.allowed).toBe(true);
  });
});
