import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/keystore';

describe('keystore', () => {
  it('round-trips a 32-byte secret with the correct passphrase', async () => {
    const secret = Buffer.from('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff', 'hex');
    const enc = await encryptSecret(secret, 'correct horse battery staple');
    const dec = await decryptSecret(enc, 'correct horse battery staple');
    expect(dec.equals(secret)).toBe(true);
  });

  it('fails to decrypt with the wrong passphrase', async () => {
    const secret = Buffer.from('deadbeef'.repeat(8), 'hex');
    const enc = await encryptSecret(secret, 'right');
    await expect(decryptSecret(enc, 'wrong')).rejects.toThrow();
  });

  it('produces distinct ciphertexts for the same secret (fresh salt + IV)', async () => {
    const secret = Buffer.alloc(32, 1);
    const a = await encryptSecret(secret, 'p');
    const b = await encryptSecret(secret, 'p');
    expect(a.ciphertext).not.toEqual(b.ciphertext);
    expect(a.kdfParams.saltHex).not.toEqual(b.kdfParams.saltHex);
    expect(a.cipherIv).not.toEqual(b.cipherIv);
  });
});
