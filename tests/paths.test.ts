import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  baseDir,
  configPath,
  isValidWalletName,
  keystorePath,
  ledgerPath,
  legacyKeystorePath,
  limitsPath,
  mnemonicPath,
  walletsDir,
} from '../src/paths';

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
    expect(keystorePath('base')).toBe('/tmp/alt-wallet-profile/wallets/base-default.json');
    expect(mnemonicPath()).toBe('/tmp/alt-wallet-profile/mnemonic.json');
    expect(configPath()).toBe('/tmp/alt-wallet-profile/config.json');
    expect(ledgerPath()).toBe('/tmp/alt-wallet-profile/history.jsonl');
    expect(limitsPath()).toBe('/tmp/alt-wallet-profile/limits.json');
  });

  it('keystorePath segments by chain and wallet name', () => {
    process.env.AGENTSCORE_PAY_HOME = '/tmp/x';
    expect(keystorePath('base')).toMatch(/base-default\.json$/);
    expect(keystorePath('solana', 'trading')).toMatch(/solana-trading\.json$/);
    expect(keystorePath('tempo', 'agent-1')).toMatch(/tempo-agent-1\.json$/);
  });

  it('legacyKeystorePath returns the pre-v0.2 single-wallet path', () => {
    process.env.AGENTSCORE_PAY_HOME = '/tmp/y';
    expect(legacyKeystorePath('base')).toBe('/tmp/y/wallets/base.json');
  });

  it('walletsDir returns the wallet folder', () => {
    process.env.AGENTSCORE_PAY_HOME = '/tmp/z';
    expect(walletsDir()).toBe('/tmp/z/wallets');
  });

  describe('isValidWalletName', () => {
    it('accepts alphanumeric + dash names', () => {
      expect(isValidWalletName('default')).toBe(true);
      expect(isValidWalletName('trading')).toBe(true);
      expect(isValidWalletName('agent-1')).toBe(true);
      expect(isValidWalletName('a1')).toBe(true);
    });

    it('rejects names with path traversal characters', () => {
      expect(isValidWalletName('../etc/passwd')).toBe(false);
      expect(isValidWalletName('foo/bar')).toBe(false);
      expect(isValidWalletName('..')).toBe(false);
    });

    it('rejects empty or too-long names', () => {
      expect(isValidWalletName('')).toBe(false);
      expect(isValidWalletName('x'.repeat(33))).toBe(false);
    });

    it('rejects names with leading or trailing dashes', () => {
      expect(isValidWalletName('-foo')).toBe(false);
      expect(isValidWalletName('foo-')).toBe(false);
    });
  });
});
