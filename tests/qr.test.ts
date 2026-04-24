import { describe, expect, it } from 'vitest';
import { qrUri as baseQr } from '../src/chains/base';
import { qrUri as solanaQr } from '../src/chains/solana';
import { qrUri as tempoQr } from '../src/chains/tempo';

describe('qr URIs', () => {
  const evmAddr = '0x1234567890abcdef1234567890abcdef12345678';
  const svmAddr = '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T';

  it('base returns bare address without amount', () => {
    expect(baseQr(evmAddr)).toBe(evmAddr);
  });

  it('base encodes EIP-681 when amount is set', () => {
    const uri = baseQr(evmAddr, 1.5);
    expect(uri).toContain('ethereum:');
    expect(uri).toContain('@8453');
    expect(uri).toContain(`address=${evmAddr}`);
    expect(uri).toContain('uint256=1500000');
  });

  it('solana returns bare solana: URI without amount', () => {
    expect(solanaQr(svmAddr)).toBe(`solana:${svmAddr}`);
  });

  it('solana encodes amount + spl-token when amount is set', () => {
    const uri = solanaQr(svmAddr, 2);
    expect(uri).toContain(`solana:${svmAddr}?`);
    expect(uri).toContain('amount=2.000000');
    expect(uri).toContain('spl-token=');
  });

  it('tempo returns bare address without amount', () => {
    expect(tempoQr(evmAddr)).toBe(evmAddr);
  });

  it('tempo encodes EIP-681 on chain 4217 when amount is set', () => {
    const uri = tempoQr(evmAddr, 3);
    expect(uri).toContain('ethereum:');
    expect(uri).toContain('@4217');
    expect(uri).toContain(`address=${evmAddr}`);
    expect(uri).toContain('uint256=3000000');
  });
});
