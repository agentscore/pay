import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { SUPPORTED_CHAINS, type Chain } from './constants';
import { CliError } from './errors';
import { baseDir, configPath } from './paths';

export { configPath } from './paths';

export const CONFIG_VERSION = 1;

export interface Config {
  version?: number;
  preferred_chains?: Chain[];
}

export const CONFIG_KEYS = ['preferred_chains'] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

export async function loadConfig(): Promise<Config> {
  try {
    const raw = await readFile(configPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const version = typeof parsed.version === 'number' ? parsed.version : CONFIG_VERSION;
    return {
      version,
      preferred_chains: parsePreferredChains(parsed.preferred_chains),
    };
  } catch (err) {
    if (isNotFound(err)) return { version: CONFIG_VERSION };
    throw err;
  }
}

export async function saveConfig(cfg: Config): Promise<void> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await mkdir(baseDir(), { recursive: true, mode: 0o700 });
  const out: Record<string, unknown> = { version: cfg.version ?? CONFIG_VERSION };
  if (cfg.preferred_chains && cfg.preferred_chains.length > 0) {
    out.preferred_chains = cfg.preferred_chains;
  }
  await writeFile(path, JSON.stringify(out, null, 2) + '\n', { mode: 0o600 });
}

export function isConfigKey(key: string): key is ConfigKey {
  return (CONFIG_KEYS as readonly string[]).includes(key);
}

export async function setConfigValue(key: string, value: string): Promise<Config> {
  if (!isConfigKey(key)) {
    throw new CliError('config_error', `Unknown config key: ${key}`, {
      extra: { valid_keys: [...CONFIG_KEYS] },
    });
  }
  const cfg = await loadConfig();
  if (key === 'preferred_chains') {
    cfg.preferred_chains = parseChainList(value);
  }
  await saveConfig(cfg);
  return cfg;
}

export async function unsetConfigValue(key: string): Promise<Config> {
  if (!isConfigKey(key)) {
    throw new CliError('config_error', `Unknown config key: ${key}`, {
      extra: { valid_keys: [...CONFIG_KEYS] },
    });
  }
  const cfg = await loadConfig();
  if (key === 'preferred_chains') delete cfg.preferred_chains;
  await saveConfig(cfg);
  return cfg;
}

export function getConfigValue(cfg: Config, key: string): unknown {
  if (!isConfigKey(key)) {
    throw new CliError('config_error', `Unknown config key: ${key}`, {
      extra: { valid_keys: [...CONFIG_KEYS] },
    });
  }
  return cfg[key];
}

function parseChainList(value: string): Chain[] {
  const chains = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const c of chains) {
    if (!(SUPPORTED_CHAINS as readonly string[]).includes(c)) {
      throw new CliError('config_error', `Unsupported chain: ${c}`, {
        extra: { valid_chains: [...SUPPORTED_CHAINS] },
      });
    }
  }
  return chains as Chain[];
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
