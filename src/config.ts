import { readFile } from 'fs/promises';
import { SUPPORTED_CHAINS, type Chain } from './constants';
import { configPath } from './paths';

export { configPath } from './paths';

export interface Config {
  preferred_chains?: Chain[];
}

export async function loadConfig(): Promise<Config> {
  try {
    const raw = await readFile(configPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      preferred_chains: parsePreferredChains(parsed.preferred_chains),
    };
  } catch (err) {
    if (isNotFound(err)) return {};
    throw err;
  }
}

function isNotFound(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT');
}

function parsePreferredChains(value: unknown): Chain[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const valid = value.filter((v): v is Chain =>
    typeof v === 'string' && (SUPPORTED_CHAINS as readonly string[]).includes(v),
  );
  return valid.length > 0 ? valid : undefined;
}
