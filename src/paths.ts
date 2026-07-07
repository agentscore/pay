import { homedir } from 'os';
import { join } from 'path';
import type { Chain } from './constants';

export const DEFAULT_WALLET_NAME = 'default';

const WALLET_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/i;

export function isValidWalletName(name: string): boolean {
  return WALLET_NAME_PATTERN.test(name);
}

export function baseDir(): string {
  return process.env.AGENTSCORE_PAY_HOME || join(homedir(), '.agentscore');
}

export function walletsDir(): string {
  return join(baseDir(), 'wallets');
}

export function keystorePath(chain: Chain, name: string = DEFAULT_WALLET_NAME): string {
  return join(walletsDir(), `${chain}-${name}.json`);
}

export function legacyKeystorePath(chain: Chain): string {
  return join(walletsDir(), `${chain}.json`);
}

export function mnemonicPath(): string {
  return join(baseDir(), 'mnemonic.json');
}

export function configPath(): string {
  return join(baseDir(), 'config.json');
}

export function ledgerPath(): string {
  return join(baseDir(), 'history.jsonl');
}

/** Encrypted Ed25519 agent key used as the AIP AIT `cnf` (proof-of-possession) key. Separate
 *  from payment wallets (chain-typed secp256k1/ed25519 keys); this is one Ed25519 key for AIT
 *  signing, independent of any chain. */
export function agentKeyPath(): string {
  return join(baseDir(), 'aip-agent-key.json');
}

export function limitsPath(): string {
  return join(baseDir(), 'limits.json');
}

export function passportPath(): string {
  return join(baseDir(), 'passport.json');
}
