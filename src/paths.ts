import { homedir } from 'os';
import { join } from 'path';
import type { Chain } from './constants';

export function baseDir(): string {
  return process.env.AGENTSCORE_PAY_HOME || join(homedir(), '.agentscore');
}

export function keystorePath(chain: Chain): string {
  return join(baseDir(), 'wallets', `${chain}.json`);
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

export function limitsPath(): string {
  return join(baseDir(), 'limits.json');
}
