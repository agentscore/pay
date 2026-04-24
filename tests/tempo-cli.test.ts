import { mkdir, rm, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TEMPO_INSTALL_URL, locateTempoCli } from '../src/tempo-cli';

const ROOT = '/tmp/pay-tempo-cli-test';

describe('tempo-cli', () => {
  let originalHome: string | undefined;
  let originalPath: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    originalPath = process.env.PATH;
    process.env.HOME = ROOT;
    // Keep PATH minimal so we don't find the real tempo CLI on the test machine
    process.env.PATH = ROOT;
    await rm(ROOT, { recursive: true, force: true });
    await mkdir(ROOT, { recursive: true });
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await rm(ROOT, { recursive: true, force: true });
  });

  it('returns not-found when tempo is absent from PATH and ~/.tempo', async () => {
    const result = await locateTempoCli();
    expect(result.found).toBe(false);
    expect(result.path).toBeUndefined();
  });

  it('finds tempo at ~/.tempo/bin/tempo when present + executable', async () => {
    const tempoBin = join(homedir(), '.tempo', 'bin', 'tempo');
    await mkdir(join(homedir(), '.tempo', 'bin'), { recursive: true });
    await writeFile(tempoBin, '#!/bin/sh\necho tempo\n', { mode: 0o755 });
    const result = await locateTempoCli();
    expect(result.found).toBe(true);
    expect(result.path).toBe(tempoBin);
  });

  it('finds tempo on PATH when ~/.tempo is empty', async () => {
    const pathDir = join(ROOT, 'local-bin');
    await mkdir(pathDir, { recursive: true });
    const tempoBin = join(pathDir, 'tempo');
    await writeFile(tempoBin, '#!/bin/sh\necho tempo\n', { mode: 0o755 });
    process.env.PATH = pathDir;
    const result = await locateTempoCli();
    expect(result.found).toBe(true);
    expect(result.path).toBe(tempoBin);
  });

  it('exposes the install URL for fallback messaging', () => {
    expect(TEMPO_INSTALL_URL).toBe('https://tempo.xyz/install');
  });
});
