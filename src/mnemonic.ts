import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { derivePath } from 'ed25519-hd-key';
import { mnemonicToAccount } from 'viem/accounts';
import { CliError } from './errors';
import type { Chain } from './constants';

const SOLANA_DERIVATION_PATH = "m/44'/501'/0'/0'";
const EVM_DERIVATION_PATH = "m/44'/60'/0'/0/0";

export function generatePhrase(strength: 128 | 256 = 128): string {
  return generateMnemonic(wordlist, strength);
}

export function validatePhrase(phrase: string): boolean {
  return validateMnemonic(phrase.trim(), wordlist);
}

export function deriveEvmKey(phrase: string): Buffer {
  if (!validatePhrase(phrase)) {
    throw new CliError('invalid_key', 'Invalid BIP-39 mnemonic phrase.', {
      nextSteps: { action: 'check_phrase', suggestion: 'Verify word count (12 or 24) and spelling against the BIP-39 English wordlist.' },
    });
  }
  const account = mnemonicToAccount(phrase, { path: EVM_DERIVATION_PATH });
  const source = account.getHdKey();
  const pk = source.privateKey;
  if (!pk) throw new CliError('invalid_key', 'Mnemonic did not yield an EVM private key.');
  return Buffer.from(pk);
}

export function deriveSolanaKey(phrase: string): Buffer {
  if (!validatePhrase(phrase)) {
    throw new CliError('invalid_key', 'Invalid BIP-39 mnemonic phrase.', {
      nextSteps: { action: 'check_phrase', suggestion: 'Verify word count (12 or 24) and spelling against the BIP-39 English wordlist.' },
    });
  }
  const seed = Buffer.from(mnemonicToSeedSync(phrase.trim()));
  const { key } = derivePath(SOLANA_DERIVATION_PATH, seed.toString('hex'));
  return Buffer.from(key);
}

export function deriveKey(chain: Chain, phrase: string): Buffer {
  if (chain === 'solana') return deriveSolanaKey(phrase);
  return deriveEvmKey(phrase);
}
