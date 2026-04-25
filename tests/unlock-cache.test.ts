import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CliError } from '../src/errors';
import {
  clearCache,
  parseDuration,
  readCachedPassphrase,
  unlockCachePath,
  writeCachedPassphrase,
} from '../src/unlock-cache';

const ROOT = '/tmp/pay-unlock-test';

describe('parseDuration', () => {
  it('parses seconds/minutes/hours/days', () => {
    expect(parseDuration('30s')).toBe(30 * 1000);
    expect(parseDuration('15m')).toBe(15 * 60 * 1000);
    expect(parseDuration('2h')).toBe(2 * 60 * 60 * 1000);
    expect(parseDuration('1d')).toBe(24 * 60 * 60 * 1000);
  });

  it('rejects malformed input', () => {
    expect(() => parseDuration('15')).toThrow(CliError);
    expect(() => parseDuration('15x')).toThrow(CliError);
    expect(() => parseDuration('')).toThrow(CliError);
    expect(() => parseDuration('abc')).toThrow(CliError);
  });

  it('trims whitespace', () => {
    expect(parseDuration('  15m  ')).toBe(15 * 60 * 1000);
  });
});

describe('unlock cache file I/O', () => {
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

  it('returns null when no cache file', async () => {
    expect(await readCachedPassphrase()).toBeNull();
  });

  it('round-trips a passphrase', async () => {
    await writeCachedPassphrase('correct horse battery staple', 60_000);
    expect(await readCachedPassphrase()).toBe('correct horse battery staple');
  });

  it('clamps TTL to MAX_TTL_MS (8h)', async () => {
    const expires = await writeCachedPassphrase('x', 99 * 60 * 60 * 1000);
    const expiresAt = Date.parse(expires);
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(8 * 60 * 60 * 1000 + 100);
  });

  it('returns null for an expired cache and removes it', async () => {
    const stale = { passphrase: 'old', expires_at: new Date(Date.now() - 1000).toISOString() };
    await writeFile(unlockCachePath(), JSON.stringify(stale), { mode: 0o600 });
    expect(await readCachedPassphrase()).toBeNull();
    await expect(readFile(unlockCachePath(), 'utf-8')).rejects.toThrow();
  });

  it('returns null for malformed cache', async () => {
    await writeFile(unlockCachePath(), 'not-json', { mode: 0o600 });
    expect(await readCachedPassphrase()).toBeNull();
  });

  it('clearCache returns true on hit, false on miss', async () => {
    expect(await clearCache()).toBe(false);
    await writeCachedPassphrase('x', 60_000);
    expect(await clearCache()).toBe(true);
    expect(await clearCache()).toBe(false);
  });

  it('rejects non-positive TTL', async () => {
    await expect(writeCachedPassphrase('x', 0)).rejects.toBeInstanceOf(CliError);
    await expect(writeCachedPassphrase('x', -1)).rejects.toBeInstanceOf(CliError);
    await expect(writeCachedPassphrase('x', NaN)).rejects.toBeInstanceOf(CliError);
  });
});
