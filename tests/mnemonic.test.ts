import { describe, expect, it } from 'vitest';
import { keyToAddress as baseKeyToAddress } from '../src/chains/base';
import { keyToAddress as solanaKeyToAddress } from '../src/chains/solana';
import { keyToAddress as tempoKeyToAddress } from '../src/chains/tempo';
import { deriveEvmKey, deriveKey, deriveSolanaKey, generatePhrase, validatePhrase } from '../src/mnemonic';

const TEST_PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

const BIP39_VECTOR_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const BIP39_VECTOR_EVM_ADDRESS = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
const BIP39_VECTOR_SOLANA_ADDRESS = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';

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

  describe('canonical BIP-39 test vector parity', () => {
    it('EVM derivation (m/44/60/0/0/0) matches MetaMask for the abandon×11+about phrase', () => {
      const key = deriveEvmKey(BIP39_VECTOR_PHRASE);
      expect(baseKeyToAddress(key)).toBe(BIP39_VECTOR_EVM_ADDRESS);
      expect(tempoKeyToAddress(key)).toBe(BIP39_VECTOR_EVM_ADDRESS);
    });

    it('Solana derivation (m/44/501/0/0 SLIP-10) matches Phantom default account 0', async () => {
      const key = deriveSolanaKey(BIP39_VECTOR_PHRASE);
      expect(await solanaKeyToAddress(key)).toBe(BIP39_VECTOR_SOLANA_ADDRESS);
    });

    it('the same phrase yields different addresses on EVM vs Solana', async () => {
      const evm = baseKeyToAddress(deriveEvmKey(BIP39_VECTOR_PHRASE));
      const sol = await solanaKeyToAddress(deriveSolanaKey(BIP39_VECTOR_PHRASE));
      expect(evm.toLowerCase()).not.toBe(sol.toLowerCase());
    });
  });
});
