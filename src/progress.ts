/**
 * Stderr-only structured progress events. Stdout belongs to incur (formatted result data),
 * so progress goes to stderr where it doesn't pollute the parsed output.
 */
export function emitProgress(event: string, data?: Record<string, unknown>): void {
  const isTty = process.stderr.isTTY ?? false;
  if (isTty) {
    process.stderr.write(data ? `${event} ${JSON.stringify(data)}\n` : `${event}\n`);
    return;
  }
  process.stderr.write(JSON.stringify({ event, ...data }) + '\n');
}
