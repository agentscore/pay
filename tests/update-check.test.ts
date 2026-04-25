import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CACHE_TTL_MS,
  fetchLatestVersion,
  getNoticeIfNewer,
  isNewer,
  readCache,
  versionCachePath,
  writeCache,
} from '../src/update-check';

const ROOT = '/tmp/pay-update-test';

describe('isNewer', () => {
  it('returns true for major bump', () => expect(isNewer('1.0.0', '2.0.0')).toBe(true));
  it('returns true for minor bump', () => expect(isNewer('1.2.0', '1.3.0')).toBe(true));
  it('returns true for patch bump', () => expect(isNewer('1.2.3', '1.2.4')).toBe(true));
  it('returns false when equal', () => expect(isNewer('1.2.3', '1.2.3')).toBe(false));
  it('returns false when current is newer', () => expect(isNewer('2.0.0', '1.9.9')).toBe(false));
  it('handles v-prefixed versions', () => expect(isNewer('v1.2.3', 'v1.2.4')).toBe(true));
  it('strips pre-release suffixes for comparison', () => expect(isNewer('1.0.0-rc.1', '1.0.0')).toBe(false));
});

describe('cache I/O', () => {
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
    expect(await readCache()).toBeNull();
  });

  it('round-trips a write/read', async () => {
    await writeCache('1.5.0');
    const cache = await readCache();
    expect(cache?.latest).toBe('1.5.0');
    expect(typeof cache?.checked_at).toBe('number');
  });

  it('versionCachePath uses baseDir', () => {
    expect(versionCachePath()).toBe(join(ROOT, '.agentscore', 'version-cache.json'));
  });
});

describe('getNoticeIfNewer', () => {
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

  it('returns latest version when cache is fresh and newer', async () => {
    await writeCache('2.0.0');
    expect(await getNoticeIfNewer('1.0.0')).toBe('2.0.0');
  });

  it('returns null when current is up-to-date', async () => {
    await writeCache('1.0.0');
    expect(await getNoticeIfNewer('1.0.0')).toBeNull();
  });

  it('returns null when cache is stale (>24h)', async () => {
    const stale = Date.now() - CACHE_TTL_MS - 1;
    await writeFile(
      join(ROOT, '.agentscore', 'version-cache.json'),
      JSON.stringify({ latest: '2.0.0', checked_at: stale }),
    );
    expect(await getNoticeIfNewer('1.0.0')).toBeNull();
  });

  it('returns null when no cache exists', async () => {
    expect(await getNoticeIfNewer('1.0.0')).toBeNull();
  });
});

describe('fetchLatestVersion', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns version on 200 + valid body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.5.1' }),
    } as Response);
    expect(await fetchLatestVersion()).toBe('0.5.1');
  });

  it('returns null on non-2xx', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as Response);
    expect(await fetchLatestVersion()).toBeNull();
  });

  it('returns null on fetch throw (network down)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await fetchLatestVersion()).toBeNull();
  });

  it('returns null when payload missing version field', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    expect(await fetchLatestVersion()).toBeNull();
  });
});

describe('refreshCacheAwaited', () => {
  let originalHome: string | undefined;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    process.env.HOME = ROOT;
    originalFetch = globalThis.fetch;
    await rm(ROOT, { recursive: true, force: true });
    await mkdir(join(ROOT, '.agentscore'), { recursive: true });
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    globalThis.fetch = originalFetch;
    await rm(ROOT, { recursive: true, force: true });
  });

  it('writes the cache when fetch resolves before the timeout', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '9.9.9' }),
    } as Response);
    const { refreshCacheAwaited, readCache } = await import('../src/update-check');
    await refreshCacheAwaited();
    const cache = await readCache();
    expect(cache?.latest).toBe('9.9.9');
  });

  it('returns even when fetch never resolves (timeout race)', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => new Promise(() => undefined));
    const { refreshCacheAwaited } = await import('../src/update-check');
    const start = Date.now();
    await refreshCacheAwaited();
    expect(Date.now() - start).toBeLessThan(3000);
  });

  it('swallows fetch errors silently', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('boom'));
    const { refreshCacheAwaited } = await import('../src/update-check');
    await expect(refreshCacheAwaited()).resolves.toBeUndefined();
  });
});
