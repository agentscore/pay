import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

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

  it('returns empty when no config file exists', async () => {
    const cfg = await loadConfig();
    expect(cfg).toEqual({});
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
});
