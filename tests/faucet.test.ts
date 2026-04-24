import { describe, expect, it } from 'vitest';
import { faucetUrls, tempoFaucetNote } from '../src/faucets';

describe('faucetUrls', () => {
  it('returns empty for mainnet', () => {
    expect(faucetUrls('base', 'mainnet')).toEqual([]);
    expect(faucetUrls('solana', 'mainnet')).toEqual([]);
    expect(faucetUrls('tempo', 'mainnet')).toEqual([]);
  });

  it('returns Circle faucet for base testnet', () => {
    const urls = faucetUrls('base', 'testnet');
    expect(urls).toContain('https://faucet.circle.com/');
    expect(urls.length).toBeGreaterThan(0);
  });

  it('returns Circle + Solana faucets for solana testnet', () => {
    const urls = faucetUrls('solana', 'testnet');
    expect(urls).toContain('https://faucet.circle.com/');
    expect(urls).toContain('https://faucet.solana.com/');
  });

  it('returns empty list for tempo (no public faucet)', () => {
    expect(faucetUrls('tempo', 'testnet')).toEqual([]);
  });

  it('tempoFaucetNote mentions the Tempo CLI', () => {
    expect(tempoFaucetNote()).toContain('tempo wallet fund');
  });
});
