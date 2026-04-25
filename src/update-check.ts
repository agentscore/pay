import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { baseDir } from './paths';

interface VersionCache {
  latest: string;
  checked_at: number;
}

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const NPM_REGISTRY = 'https://registry.npmjs.org/@agent-score/pay/latest';
const FETCH_TIMEOUT_MS = 2000;

export function versionCachePath(): string {
  return join(baseDir(), 'version-cache.json');
}

export async function readCache(): Promise<VersionCache | null> {
  try {
    const raw = await readFile(versionCachePath(), 'utf-8');
    return JSON.parse(raw) as VersionCache;
  } catch {
    return null;
  }
}

export async function writeCache(latest: string): Promise<void> {
  const path = versionCachePath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const payload: VersionCache = { latest, checked_at: Date.now() };
  await writeFile(path, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 });
}

export function isNewer(current: string, latest: string): boolean {
  const a = parseSemver(current);
  const b = parseSemver(latest);
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return true;
    if (a[i] > b[i]) return false;
  }
  return false;
}

function parseSemver(v: string): [number, number, number] {
  const cleaned = v.replace(/^v/, '').split('-')[0];
  const parts = cleaned.split('.').map((p) => Number.parseInt(p, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

export async function fetchLatestVersion(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(NPM_REGISTRY, { signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return typeof data.version === 'string' ? data.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getNoticeIfNewer(current: string): Promise<string | null> {
  const cache = await readCache();
  if (!cache) return null;
  if (Date.now() - cache.checked_at > CACHE_TTL_MS) return null;
  if (!isNewer(current, cache.latest)) return null;
  return cache.latest;
}

export function refreshCacheInBackground(): void {
  fetchLatestVersion()
    .then((latest) => (latest ? writeCache(latest) : undefined))
    .catch(() => {
      /* best-effort */
    });
}
