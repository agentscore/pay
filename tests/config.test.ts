import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CONFIG_KEYS,
  isConfigKey,
  loadConfig,
  saveConfig,
  setConfigValue,
  unsetConfigValue,
} from '../src/config';
import { CliError } from '../src/errors';

const ROOT = '/tmp/pay-config-test';

describe('config', () => {
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

  it('returns just the version when no config file exists', async () => {
    const cfg = await loadConfig();
    expect(cfg).toEqual({ version: 1 });
  });

  it('parses preferred_chains', async () => {
    await writeFile(
      join(ROOT, '.agentscore', 'config.json'),
      JSON.stringify({ preferred_chains: ['tempo', 'base'] }),
    );
    const cfg = await loadConfig();
    expect(cfg.preferred_chains).toEqual(['tempo', 'base']);
  });

  it('filters unsupported chain names out of preferred_chains', async () => {
    await writeFile(
      join(ROOT, '.agentscore', 'config.json'),
      JSON.stringify({ preferred_chains: ['tempo', 'mars', 'base'] }),
    );
    const cfg = await loadConfig();
    expect(cfg.preferred_chains).toEqual(['tempo', 'base']);
  });

  it('returns undefined for preferred_chains when all values invalid', async () => {
    await writeFile(
      join(ROOT, '.agentscore', 'config.json'),
      JSON.stringify({ preferred_chains: ['mars', 'saturn'] }),
    );
    const cfg = await loadConfig();
    expect(cfg.preferred_chains).toBeUndefined();
  });

  it('ignores unknown top-level keys', async () => {
    await writeFile(
      join(ROOT, '.agentscore', 'config.json'),
      JSON.stringify({ preferred_chains: ['base'], future_feature: 'hello' }),
    );
    const cfg = await loadConfig();
    expect(cfg.preferred_chains).toEqual(['base']);
  });

  describe('saveConfig', () => {
    it('persists preferred_chains and is round-trip safe', async () => {
      await saveConfig({ preferred_chains: ['solana', 'tempo'] });
      const cfg = await loadConfig();
      expect(cfg.preferred_chains).toEqual(['solana', 'tempo']);
    });

    it('omits empty preferred_chains but always writes version', async () => {
      await saveConfig({ preferred_chains: [] });
      const raw = await readFile(join(ROOT, '.agentscore', 'config.json'), 'utf-8');
      expect(JSON.parse(raw)).toEqual({ version: 1 });
    });

    it('reads back configs missing version (defaults to current)', async () => {
      await writeFile(join(ROOT, '.agentscore', 'config.json'), JSON.stringify({ preferred_chains: ['base'] }));
      const cfg = await loadConfig();
      expect(cfg.version).toBe(1);
      expect(cfg.preferred_chains).toEqual(['base']);
    });
  });

  describe('setConfigValue', () => {
    it('sets preferred_chains from comma-separated input', async () => {
      const cfg = await setConfigValue('preferred_chains', 'tempo, base, solana');
      expect(cfg.preferred_chains).toEqual(['tempo', 'base', 'solana']);
      const reloaded = await loadConfig();
      expect(reloaded.preferred_chains).toEqual(['tempo', 'base', 'solana']);
    });

    it('rejects unknown config keys', async () => {
      await expect(setConfigValue('mystery', 'x')).rejects.toBeInstanceOf(CliError);
      await expect(setConfigValue('mystery', 'x')).rejects.toMatchObject({ code: 'config_error' });
    });

    it('rejects unsupported chain names in preferred_chains', async () => {
      await expect(setConfigValue('preferred_chains', 'tempo,mars')).rejects.toMatchObject({
        code: 'config_error',
      });
    });

    it('overwrites existing value', async () => {
      await setConfigValue('preferred_chains', 'base');
      await setConfigValue('preferred_chains', 'tempo,solana');
      const cfg = await loadConfig();
      expect(cfg.preferred_chains).toEqual(['tempo', 'solana']);
    });
  });

  describe('unsetConfigValue', () => {
    it('removes a previously-set key', async () => {
      await setConfigValue('preferred_chains', 'base,tempo');
      await unsetConfigValue('preferred_chains');
      const cfg = await loadConfig();
      expect(cfg.preferred_chains).toBeUndefined();
    });

    it('is a no-op for an already-unset key', async () => {
      await unsetConfigValue('preferred_chains');
      const cfg = await loadConfig();
      expect(cfg).toEqual({ version: 1 });
    });

    it('rejects unknown keys', async () => {
      await expect(unsetConfigValue('mystery')).rejects.toMatchObject({ code: 'config_error' });
    });
  });

  describe('isConfigKey', () => {
    it('returns true for known keys', () => {
      expect(isConfigKey('preferred_chains')).toBe(true);
    });
    it('returns false for unknown keys', () => {
      expect(isConfigKey('mystery')).toBe(false);
    });
    it('CONFIG_KEYS list exposes preferred_chains', () => {
      expect(CONFIG_KEYS).toContain('preferred_chains');
    });
  });
});
