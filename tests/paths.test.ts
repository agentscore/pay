import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { baseDir, configPath, keystorePath, ledgerPath, limitsPath, mnemonicPath } from '../src/paths';

describe('paths', () => {
  let originalHome: string | undefined;
  let originalAltHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    originalAltHome = process.env.AGENTSCORE_PAY_HOME;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalAltHome === undefined) delete process.env.AGENTSCORE_PAY_HOME;
    else process.env.AGENTSCORE_PAY_HOME = originalAltHome;
  });

  it('defaults to $HOME/.agentscore', () => {
    process.env.HOME = '/tmp/fake-home';
    delete process.env.AGENTSCORE_PAY_HOME;
    expect(baseDir()).toBe('/tmp/fake-home/.agentscore');
  });

  it('AGENTSCORE_PAY_HOME env var overrides base dir', () => {
    process.env.AGENTSCORE_PAY_HOME = '/tmp/alt-wallet-profile';
    expect(baseDir()).toBe('/tmp/alt-wallet-profile');
    expect(keystorePath('base')).toBe('/tmp/alt-wallet-profile/wallets/base.json');
    expect(mnemonicPath()).toBe('/tmp/alt-wallet-profile/mnemonic.json');
    expect(configPath()).toBe('/tmp/alt-wallet-profile/config.json');
    expect(ledgerPath()).toBe('/tmp/alt-wallet-profile/history.jsonl');
    expect(limitsPath()).toBe('/tmp/alt-wallet-profile/limits.json');
  });

  it('keystorePath segments by chain', () => {
    process.env.AGENTSCORE_PAY_HOME = '/tmp/x';
    expect(keystorePath('base')).toMatch(/base\.json$/);
    expect(keystorePath('solana')).toMatch(/solana\.json$/);
    expect(keystorePath('tempo')).toMatch(/tempo\.json$/);
  });
});
