import { describe, expect, it } from 'vitest';
import { isKnownUSDC, onrampUrl, SUPPORTED_CHAINS, USDC } from '../src/constants';

describe('constants', () => {
  it('supports base, solana, tempo', () => {
    expect([...SUPPORTED_CHAINS].sort()).toEqual(['base', 'solana', 'tempo']);
  });

  it('USDC has mainnet data for all supported chains', () => {
    expect(USDC.base.mainnet.chainId).toBe(8453);
    expect(USDC.solana.mainnet.mint).toMatch(/^EPjFWdd/);
    expect(USDC.tempo.mainnet.chainId).toBe(4217);
    expect(USDC.tempo.mainnet.address.toLowerCase()).toBe('0x20c000000000000000000000b9537d11c60e8b50');
  });

  it('onrampUrl returns Coinbase Pay URL for base', () => {
    const url = onrampUrl('base', '0xABC');
    expect(url).toContain('pay.coinbase.com');
    expect(url).toContain('defaultNetwork=base');
    expect(url).toContain(encodeURIComponent('0xABC'));
  });

  it('onrampUrl returns Coinbase Pay URL for solana', () => {
    const url = onrampUrl('solana', '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T');
    expect(url).toContain('defaultNetwork=solana');
  });

  it('onrampUrl returns null for tempo', () => {
    expect(onrampUrl('tempo', '0xABC')).toBeNull();
  });

  it('onrampUrl includes amount when provided', () => {
    const url = onrampUrl('base', '0xABC', 50);
    expect(url).toContain('presetFiatAmount=50');
  });

  describe('isKnownUSDC', () => {
    it('matches base USDC mainnet + sepolia case-insensitively', () => {
      expect(isKnownUSDC(USDC.base.mainnet.address, 'base')).toBe(true);
      expect(isKnownUSDC(USDC.base.mainnet.address.toLowerCase(), 'base')).toBe(true);
      expect(isKnownUSDC(USDC.base.sepolia.address, 'base')).toBe(true);
      expect(isKnownUSDC(USDC.base.sepolia.address.toUpperCase(), 'base')).toBe(true);
    });

    it('matches solana USDC mint + devnet mint exactly (base58 is case-sensitive)', () => {
      expect(isKnownUSDC(USDC.solana.mainnet.mint, 'solana')).toBe(true);
      expect(isKnownUSDC(USDC.solana.devnet.mint, 'solana')).toBe(true);
      expect(isKnownUSDC(USDC.solana.mainnet.mint.toLowerCase(), 'solana')).toBe(false);
    });

    it('matches tempo USDC.e mainnet + testnet', () => {
      expect(isKnownUSDC(USDC.tempo.mainnet.address, 'tempo')).toBe(true);
      expect(isKnownUSDC(USDC.tempo.testnet.address, 'tempo')).toBe(true);
    });

    it('rejects unknown assets and missing input', () => {
      expect(isKnownUSDC('0x0000000000000000000000000000000000000001', 'base')).toBe(false);
      expect(isKnownUSDC(null, 'base')).toBe(false);
      expect(isKnownUSDC(undefined, 'base')).toBe(false);
      expect(isKnownUSDC('', 'base')).toBe(false);
    });

    it('rejects cross-chain matches (USDC mint on base chain, etc.)', () => {
      expect(isKnownUSDC(USDC.solana.mainnet.mint, 'base')).toBe(false);
      expect(isKnownUSDC(USDC.base.mainnet.address, 'solana')).toBe(false);
    });
  });
});
