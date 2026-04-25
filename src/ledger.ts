import { appendFile, mkdir, readFile } from 'fs/promises';
import { dirname } from 'path';
import { ledgerPath } from './paths';
import type { Chain } from './constants';

export { ledgerPath } from './paths';

export interface LedgerEntry {
  timestamp: string;
  chain: Chain;
  signer: string;
  method: string;
  url: string;
  host: string;
  status: number;
  protocol: 'x402' | 'mpp';
  price_usd?: string;
  tx_hash?: string;
  next_steps_action?: string;
  ok: boolean;
}

export async function appendEntry(entry: LedgerEntry): Promise<void> {
  const path = ledgerPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await appendFile(path, JSON.stringify(entry) + '\n', { mode: 0o600 });
}

export async function readEntries(limit?: number): Promise<LedgerEntry[]> {
  try {
    const raw = await readFile(ledgerPath(), 'utf-8');
    const lines = raw.split('\n').filter((l) => l.length > 0);
    const entries = lines
      .map((line) => {
        try {
          return JSON.parse(line) as LedgerEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is LedgerEntry => e !== null);
    entries.reverse();
    return limit ? entries.slice(0, limit) : entries;
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT') return [];
    throw err;
  }
}
