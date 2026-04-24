import { readEntries } from '../ledger';
import { isJson, writeJson, writeLine } from '../output';

export interface HistoryOptions {
  limit?: number;
}

export async function history(opts: HistoryOptions = {}): Promise<void> {
  const entries = await readEntries(opts.limit);
  if (isJson()) {
    writeJson(entries);
    return;
  }
  if (entries.length === 0) {
    writeLine('No payment history.');
    return;
  }
  writeLine('Time                        Chain      Price      Status   Host');
  for (const e of entries) {
    const ts = e.timestamp.slice(0, 19).replace('T', ' ');
    const price = e.price_usd ? `$${e.price_usd}` : '?';
    const status = `${e.status}${e.ok ? ' ✓' : ' ✗'}`;
    writeLine(`${ts}  ${e.chain.padEnd(8)}  ${price.padStart(8)}  ${status.padEnd(7)}  ${e.host}`);
  }
}
