import { bold, dim, green, red } from '../colors';
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
  writeLine(bold('Time                 Chain      Price      Status   Host                          Action            Tx'));
  for (const e of entries) {
    const ts = dim(e.timestamp.slice(0, 19).replace('T', ' '));
    const price = e.price_usd ? `$${e.price_usd}` : '?';
    const statusText = `${e.status}${e.ok ? ' ✓' : ' ✗'}`;
    const status = e.ok ? green(statusText) : red(statusText);
    const host = e.host.length > 30 ? e.host.slice(0, 27) + '…' : e.host;
    const action = e.next_steps_action ? truncate(e.next_steps_action, 16) : '-';
    const tx = e.tx_hash ? dim(short(e.tx_hash)) : dim('-');
    writeLine(
      `${ts}  ${e.chain.padEnd(8)}  ${price.padStart(8)}  ${status.padEnd(7)}  ${host.padEnd(30)}  ${action.padEnd(16)}  ${tx}`,
    );
  }
}

function short(hash: string): string {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
