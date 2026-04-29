import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { history } from '../src/commands/history';

const ROOT = '/tmp/pay-history-test';

describe('history command', () => {
  let originalHome: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    process.env.HOME = ROOT;
    await rm(ROOT, { recursive: true, force: true });
    await mkdir(join(ROOT, '.agentscore'), { recursive: true });
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(ROOT, { recursive: true, force: true });
  });

  it('returns empty entries when no history file exists', async () => {
    const result = await history();
    expect(result.entries).toEqual([]);
    expect(result.malformed_lines).toBeUndefined();
  });

  it('parses well-formed JSONL entries', async () => {
    const lines = [
      JSON.stringify({ timestamp: '2026-04-28T00:00:00Z', chain: 'base', method: 'POST', url: 'https://m.example/x', status: 200, ok: true }),
      JSON.stringify({ timestamp: '2026-04-28T00:01:00Z', chain: 'tempo', method: 'POST', url: 'https://m.example/y', status: 200, ok: true }),
    ].join('\n') + '\n';
    await writeFile(join(ROOT, '.agentscore', 'history.jsonl'), lines);
    const result = await history();
    expect(result.entries).toHaveLength(2);
    // History returns most-recent first
    const urls = result.entries.map((e) => e.url).sort();
    expect(urls).toEqual(['https://m.example/x', 'https://m.example/y']);
    expect(result.malformed_lines).toBeUndefined();
  });

  it('reports malformed_lines count when JSONL has bad rows', async () => {
    const content = '{"timestamp":"2026-04-28T00:00:00Z","chain":"base"}\nNOT JSON\n{"timestamp":"2026-04-28T00:02:00Z","chain":"tempo"}\n';
    await writeFile(join(ROOT, '.agentscore', 'history.jsonl'), content);
    const result = await history();
    expect(result.entries).toHaveLength(2);
    expect(result.malformed_lines).toBe(1);
  });

  it('honors --limit', async () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ timestamp: `2026-04-28T00:0${i}:00Z`, chain: 'base', method: 'GET', url: `https://m.example/${i}`, status: 200, ok: true }),
    ).join('\n') + '\n';
    await writeFile(join(ROOT, '.agentscore', 'history.jsonl'), lines);
    const result = await history({ limit: 3 });
    expect(result.entries).toHaveLength(3);
  });
});
