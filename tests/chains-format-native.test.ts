import { describe, expect, it } from 'vitest';
import * as baseChain from '../src/chains/base';
import * as solanaChain from '../src/chains/solana';
import * as tempoChain from '../src/chains/tempo';

describe('chains — formatNative + NATIVE_SYMBOL', () => {
  describe('base (ETH, 18 decimals)', () => {
    it('formats whole + fractional ETH to 6 digits', () => {
      // 1.5 ETH = 1.5 * 10^18 = 1500000000000000000
      expect(baseChain.formatNative(1_500_000_000_000_000_000n)).toBe('1.500000');
    });
    it('formats zero', () => {
      expect(baseChain.formatNative(0n)).toBe('0.000000');
    });
    it('truncates to 6 fractional digits', () => {
      // 1.234567890123 ETH
      expect(baseChain.formatNative(1_234_567_890_123_456_789n)).toBe('1.234567');
    });
    it('handles large whole', () => {
      // 1000 ETH
      expect(baseChain.formatNative(1_000n * 10n ** 18n)).toBe('1000.000000');
    });
    it('exports NATIVE_SYMBOL = ETH', () => {
      expect(baseChain.NATIVE_SYMBOL).toBe('ETH');
    });
  });

  describe('tempo (TEMPO, 18 decimals)', () => {
    it('formats whole + fractional TEMPO to 6 digits', () => {
      expect(tempoChain.formatNative(2_750_000_000_000_000_000n)).toBe('2.750000');
    });
    it('formats zero', () => {
      expect(tempoChain.formatNative(0n)).toBe('0.000000');
    });
    it('exports NATIVE_SYMBOL = TEMPO', () => {
      expect(tempoChain.NATIVE_SYMBOL).toBe('TEMPO');
    });
  });

  describe('solana (SOL, 9 decimals)', () => {
    it('formats whole + fractional SOL to 4 digits', () => {
      // 1.5 SOL = 1.5 * 10^9 = 1500000000 lamports
      expect(solanaChain.formatNative(1_500_000_000n)).toBe('1.5000');
    });
    it('formats zero', () => {
      expect(solanaChain.formatNative(0n)).toBe('0.0000');
    });
    it('truncates to 4 fractional digits', () => {
      // 1.23456789 SOL
      expect(solanaChain.formatNative(1_234_567_890n)).toBe('1.2345');
    });
    it('handles large whole', () => {
      // 1000 SOL
      expect(solanaChain.formatNative(1_000n * 10n ** 9n)).toBe('1000.0000');
    });
    it('exports NATIVE_SYMBOL = SOL', () => {
      expect(solanaChain.NATIVE_SYMBOL).toBe('SOL');
    });
  });
});

describe('chains — transferNative input validation (no RPC)', () => {
  it('solana rejects non-base58 recipient', async () => {
    await expect(
      solanaChain.transferNative({
        key: Buffer.alloc(32, 1),
        to: '0x' + '1'.repeat(40),
        amountNative: 0.01,
      }),
    ).rejects.toMatchObject({ code: 'invalid_wallet_address' });
  });
});
