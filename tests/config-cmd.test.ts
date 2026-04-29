import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = '/tmp/pay-config-cmd-test';

describe('config command', () => {
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

  it('configPathCmd returns {path}', async () => {
    const { configPathCmd } = await import('../src/commands/config');
    const result = await configPathCmd();
    expect(result.path).toMatch(/config\.json$/);
  });

  it('configGet (no key) returns {path, config, valid_keys}', async () => {
    const { configGet } = await import('../src/commands/config');
    const result = await configGet();
    expect(result.path).toMatch(/config\.json$/);
    expect(result.config).toEqual({ version: 1 });
    expect(result.valid_keys).toBeDefined();
  });

  it('configGet for an unset key returns {key, value: null}', async () => {
    const { configGet } = await import('../src/commands/config');
    const result = await configGet({ key: 'preferred_chains' });
    expect(result).toMatchObject({ key: 'preferred_chains', value: null });
  });

  it('configSet → configGet round-trip', async () => {
    const { configSet, configGet } = await import('../src/commands/config');
    await configSet({ key: 'preferred_chains', value: 'tempo,base' });
    const result = await configGet({ key: 'preferred_chains' });
    expect(result).toMatchObject({ key: 'preferred_chains', value: ['tempo', 'base'] });
  });

  it('configUnset removes the key, configGet returns null again', async () => {
    const { configSet, configUnset, configGet } = await import('../src/commands/config');
    await configSet({ key: 'preferred_chains', value: 'tempo' });
    await configUnset({ key: 'preferred_chains' });
    const result = await configGet({ key: 'preferred_chains' });
    expect(result).toMatchObject({ key: 'preferred_chains', value: null });
  });

  it('rejects unknown keys at set time', async () => {
    const { configSet } = await import('../src/commands/config');
    await expect(configSet({ key: 'mystery', value: 'x' })).rejects.toMatchObject({ code: 'config_error' });
  });

  it('rejects unsupported chain in preferred_chains', async () => {
    const { configSet } = await import('../src/commands/config');
    await expect(configSet({ key: 'preferred_chains', value: 'tempo,mars' })).rejects.toMatchObject({
      code: 'config_error',
    });
  });
});
