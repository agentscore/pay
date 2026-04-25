import { bold, dim, green } from '../colors';
import {
  CONFIG_KEYS,
  configPath,
  getConfigValue,
  loadConfig,
  setConfigValue,
  unsetConfigValue,
  type Config,
} from '../config';
import { isJson, writeJson, writeLine } from '../output';

export async function configGet(key?: string): Promise<void> {
  const cfg = await loadConfig();
  if (key) {
    const value = getConfigValue(cfg, key);
    if (isJson()) {
      writeJson({ key, value: value ?? null });
      return;
    }
    if (value === undefined) writeLine('(unset)');
    else writeLine(formatValue(value));
    return;
  }
  if (isJson()) {
    writeJson({ path: configPath(), config: cfg });
    return;
  }
  writeLine(`${bold('config')}: ${dim(configPath())}`);
  if (Object.keys(cfg).length === 0) {
    writeLine(dim('(empty — no preferences set)'));
    writeLine('');
    writeLine(dim(`Valid keys: ${CONFIG_KEYS.join(', ')}`));
    return;
  }
  for (const k of CONFIG_KEYS) {
    const v = (cfg as Record<string, unknown>)[k];
    if (v === undefined) continue;
    writeLine(`  ${k} = ${bold(formatValue(v))}`);
  }
}

export async function configSet(key: string, value: string): Promise<void> {
  const cfg = await setConfigValue(key, value);
  if (isJson()) {
    writeJson({ ok: true, key, value: getConfigValue(cfg, key) ?? null, path: configPath() });
    return;
  }
  writeLine(`${green('✓')} ${key} = ${bold(formatValue(getConfigValue(cfg, key) ?? '(unset)'))}`);
  writeLine(dim(`  (${configPath()})`));
}

export async function configUnset(key: string): Promise<void> {
  await unsetConfigValue(key);
  if (isJson()) {
    writeJson({ ok: true, key, removed: true, path: configPath() });
    return;
  }
  writeLine(`${green('✓')} unset ${key}`);
  writeLine(dim(`  (${configPath()})`));
}

export async function configPathCmd(): Promise<void> {
  if (isJson()) {
    writeJson({ path: configPath() });
    return;
  }
  writeLine(configPath());
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(',');
  if (value === null) return '(null)';
  return String(value);
}

export type { Config };
