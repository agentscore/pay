import { describe, expect, it } from 'vitest';
import { deriveEvmKey, deriveKey, deriveSolanaKey, generatePhrase, validatePhrase } from '../src/mnemonic';

const TEST_PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

describe('mnemonic', () => {
  it('generatePhrase produces 12-word phrases that validate', () => {
    const phrase = generatePhrase(128);
    expect(phrase.split(' ')).toHaveLength(12);
    expect(validatePhrase(phrase)).toBe(true);
  });

  it('generatePhrase(256) produces 24 words', () => {
    const phrase = generatePhrase(256);
    expect(phrase.split(' ')).toHaveLength(24);
    expect(validatePhrase(phrase)).toBe(true);
  });

  it('validatePhrase rejects bogus phrases', () => {
    expect(validatePhrase('not really a phrase')).toBe(false);
    expect(validatePhrase('legal winner thank year wave sausage worth useful legal winner thank banana')).toBe(false);
  });

  it('deriveEvmKey returns 32 bytes deterministically', () => {
    const a = deriveEvmKey(TEST_PHRASE);
    const b = deriveEvmKey(TEST_PHRASE);
    expect(a.length).toBe(32);
    expect(a.equals(b)).toBe(true);
  });

  it('deriveSolanaKey returns 32 bytes deterministically', () => {
    const a = deriveSolanaKey(TEST_PHRASE);
    const b = deriveSolanaKey(TEST_PHRASE);
    expect(a.length).toBe(32);
    expect(a.equals(b)).toBe(true);
  });

  it('EVM and Solana derivations differ from the same seed', () => {
    const evm = deriveEvmKey(TEST_PHRASE);
    const svm = deriveSolanaKey(TEST_PHRASE);
    expect(evm.equals(svm)).toBe(false);
  });

  it('deriveKey dispatches per chain', () => {
    expect(deriveKey('base', TEST_PHRASE).equals(deriveEvmKey(TEST_PHRASE))).toBe(true);
    expect(deriveKey('tempo', TEST_PHRASE).equals(deriveEvmKey(TEST_PHRASE))).toBe(true);
    expect(deriveKey('solana', TEST_PHRASE).equals(deriveSolanaKey(TEST_PHRASE))).toBe(true);
  });

  it('deriveEvmKey throws on invalid phrase', () => {
    expect(() => deriveEvmKey('bogus')).toThrowError(/Invalid BIP-39/);
  });
});
