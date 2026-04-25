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

export interface ReadEntriesResult {
  entries: LedgerEntry[];
  malformed_lines: number;
}

export async function appendEntry(entry: LedgerEntry): Promise<void> {
  const path = ledgerPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await appendFile(path, JSON.stringify(entry) + '\n', { mode: 0o600 });
}

export async function readEntriesWithMeta(limit?: number): Promise<ReadEntriesResult> {
  try {
    const raw = await readFile(ledgerPath(), 'utf-8');
    const lines = raw.split('\n').filter((l) => l.length > 0);
    let malformed = 0;
    const entries = lines
      .map((line) => {
        try {
          return JSON.parse(line) as LedgerEntry;
        } catch {
          malformed += 1;
          return null;
        }
      })
      .filter((e): e is LedgerEntry => e !== null);
    entries.reverse();
    return { entries: limit ? entries.slice(0, limit) : entries, malformed_lines: malformed };
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT') {
      return { entries: [], malformed_lines: 0 };
    }
    throw err;
  }
}

export async function readEntries(limit?: number): Promise<LedgerEntry[]> {
  const { entries } = await readEntriesWithMeta(limit);
  return entries;
}
