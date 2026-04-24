import { describe, expect, it } from 'vitest';
import { onrampUrl, SUPPORTED_CHAINS, USDC } from '../src/constants';

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
});
