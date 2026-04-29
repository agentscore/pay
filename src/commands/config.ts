import {
  CONFIG_KEYS,
  configPath,
  getConfigValue,
  loadConfig,
  setConfigValue,
  unsetConfigValue,
  type Config,
} from '../config';

export async function configGet(input: { key?: string } = {}): Promise<{
  path: string;
  key?: string;
  value?: unknown;
  config?: Config;
  valid_keys?: string[];
}> {
  const cfg = await loadConfig();
  if (input.key) {
    return { path: configPath(), key: input.key, value: getConfigValue(cfg, input.key) ?? null };
  }
  return { path: configPath(), config: cfg, valid_keys: [...CONFIG_KEYS] };
}

export async function configSet(input: { key: string; value: string }): Promise<{
  ok: true;
  key: string;
  value: unknown;
  path: string;
}> {
  const cfg = await setConfigValue(input.key, input.value);
  return { ok: true, key: input.key, value: getConfigValue(cfg, input.key) ?? null, path: configPath() };
}

export async function configUnset(input: { key: string }): Promise<{
  ok: true;
  key: string;
  removed: true;
  path: string;
}> {
  await unsetConfigValue(input.key);
  return { ok: true, key: input.key, removed: true, path: configPath() };
}

export async function configPathCmd(): Promise<{ path: string }> {
  return { path: configPath() };
}

export type { Config };
