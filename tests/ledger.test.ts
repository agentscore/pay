import { mkdir, rm } from 'fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendEntry, readEntries } from '../src/ledger';

const ROOT = '/tmp/pay-ledger-test';

describe('ledger', () => {
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

  it('returns empty array when no history file', async () => {
    const entries = await readEntries();
    expect(entries).toEqual([]);
  });

  it('appends and reads entries (most recent first)', async () => {
    await appendEntry({
      timestamp: '2026-04-24T10:00:00Z',
      chain: 'base',
      signer: '0xabc',
      method: 'POST',
      url: 'https://a.example/x',
      host: 'a.example',
      status: 200,
      protocol: 'x402',
      ok: true,
    });
    await appendEntry({
      timestamp: '2026-04-24T11:00:00Z',
      chain: 'tempo',
      signer: '0xdef',
      method: 'POST',
      url: 'https://b.example/y',
      host: 'b.example',
      status: 200,
      protocol: 'mpp',
      ok: true,
    });
    const entries = await readEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.host).toBe('b.example');
    expect(entries[1]?.host).toBe('a.example');
  });

  it('applies limit', async () => {
    for (let i = 0; i < 5; i++) {
      await appendEntry({
        timestamp: `2026-04-24T${String(i).padStart(2, '0')}:00:00Z`,
        chain: 'base',
        signer: '0x',
        method: 'GET',
        url: `https://x/${i}`,
        host: 'x',
        status: 200,
        protocol: 'x402',
        ok: true,
      });
    }
    const entries = await readEntries(2);
    expect(entries).toHaveLength(2);
  });

  it('skips malformed lines silently', async () => {
    await appendEntry({
      timestamp: '2026-04-24T10:00:00Z',
      chain: 'base',
      signer: '0xabc',
      method: 'POST',
      url: 'https://x',
      host: 'x',
      status: 200,
      protocol: 'x402',
      ok: true,
    });
    const fs = await import('fs/promises');
    const { ledgerPath } = await import('../src/ledger');
    await fs.appendFile(ledgerPath(), 'not-json\n');
    const entries = await readEntries();
    expect(entries).toHaveLength(1);
  });
});
