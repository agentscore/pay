import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ROOT = '/tmp/pay-config-cmd-test';

describe('config command (CLI surface)', () => {
  let originalHome: string | undefined;
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    process.env.HOME = ROOT;
    await rm(ROOT, { recursive: true, force: true });
    await mkdir(join(ROOT, '.agentscore'), { recursive: true });
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.resetModules();
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    stdout.mockRestore();
    await rm(ROOT, { recursive: true, force: true });
  });

  function out() {
    return stdout.mock.calls.map((c) => String(c[0])).join('');
  }
  function jsonOut() {
    return JSON.parse(out().trim().split('\n').pop()!);
  }

  describe('JSON mode', () => {
    beforeEach(async () => {
      const { setMode } = await import('../src/output');
      setMode('json');
    });

    it('configPathCmd prints {path}', async () => {
      const { configPathCmd } = await import('../src/commands/config');
      await configPathCmd();
      expect(jsonOut().path).toMatch(/config\.json$/);
    });

    it('configGet (no key) returns {path, config}', async () => {
      const { configGet } = await import('../src/commands/config');
      await configGet();
      const o = jsonOut();
      expect(o.path).toMatch(/config\.json$/);
      expect(o.config).toEqual({ version: 1 });
    });

    it('configGet for an unset key returns {key, value: null}', async () => {
      const { configGet } = await import('../src/commands/config');
      await configGet('preferred_chains');
      expect(jsonOut()).toEqual({ key: 'preferred_chains', value: null });
    });

    it('configSet → configGet round-trip', async () => {
      const { configSet, configGet } = await import('../src/commands/config');
      await configSet('preferred_chains', 'tempo,base');
      stdout.mockClear();
      await configGet('preferred_chains');
      expect(jsonOut()).toEqual({ key: 'preferred_chains', value: ['tempo', 'base'] });
    });

    it('configUnset removes the key, configGet returns null again', async () => {
      const { configSet, configUnset, configGet } = await import('../src/commands/config');
      await configSet('preferred_chains', 'tempo');
      await configUnset('preferred_chains');
      stdout.mockClear();
      await configGet('preferred_chains');
      expect(jsonOut()).toEqual({ key: 'preferred_chains', value: null });
    });

    it('rejects unknown keys at set time', async () => {
      const { configSet } = await import('../src/commands/config');
      await expect(configSet('mystery', 'x')).rejects.toMatchObject({ code: 'config_error' });
    });

    it('rejects unsupported chain in preferred_chains', async () => {
      const { configSet } = await import('../src/commands/config');
      await expect(configSet('preferred_chains', 'tempo,mars')).rejects.toMatchObject({ code: 'config_error' });
    });
  });

  describe('human mode', () => {
    beforeEach(async () => {
      const { setMode } = await import('../src/output');
      setMode('human');
    });

    it('configGet (empty) shows the (empty) hint with valid keys list', async () => {
      const { configGet } = await import('../src/commands/config');
      await configGet();
      const o = out();
      expect(o).toMatch(/config:.*config\.json/);
      expect(o).toContain('(empty');
      expect(o).toContain('preferred_chains');
    });

    it('configSet prints a checkmark + path note', async () => {
      const { configSet } = await import('../src/commands/config');
      await configSet('preferred_chains', 'tempo');
      const o = out();
      expect(o).toContain('preferred_chains');
      expect(o).toContain('tempo');
      expect(o).toMatch(/config\.json/);
    });
  });
});
