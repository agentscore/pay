import { readEntriesWithMeta } from '../ledger';

export async function history(input: { limit?: number } = {}): Promise<{
  entries: Awaited<ReturnType<typeof readEntriesWithMeta>>['entries'];
  malformed_lines?: number;
}> {
  const { entries, malformed_lines } = await readEntriesWithMeta(input.limit);
  return {
    entries,
    ...(malformed_lines > 0 ? { malformed_lines } : {}),
  };
}
