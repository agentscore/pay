import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  decryptSecret,
  deleteKeystore,
  encryptSecret,
  keystoreExists,
  listWallets,
  loadKeystore,
  saveKeystore,
} from '../src/keystore';

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

  describe('named wallets + backward compat', () => {
    const ROOT = '/tmp/pay-keystore-test';
    let originalHome: string | undefined;

    async function makeKeystore(suffixPath: string, chain: 'base' | 'solana' | 'tempo'): Promise<void> {
      const enc = await encryptSecret(Buffer.alloc(32, 7), 'pw');
      await writeFile(
        join(ROOT, '.agentscore', 'wallets', suffixPath),
        JSON.stringify({ version: 1, chain, address: '0xtest', encryption: enc }),
      );
    }

    beforeEach(async () => {
      originalHome = process.env.HOME;
      process.env.HOME = ROOT;
      await rm(ROOT, { recursive: true, force: true });
      await mkdir(join(ROOT, '.agentscore', 'wallets'), { recursive: true });
    });

    afterEach(async () => {
      process.env.HOME = originalHome;
      await rm(ROOT, { recursive: true, force: true });
    });

    it('saveKeystore writes to <chain>-<name>.json', async () => {
      const enc = await encryptSecret(Buffer.alloc(32, 1), 'pw');
      const path = await saveKeystore({ version: 1, chain: 'base', address: '0xa', name: 'trading', encryption: enc });
      expect(path).toMatch(/wallets\/base-trading\.json$/);
    });

    it('loadKeystore reads named wallet by chain+name', async () => {
      const enc = await encryptSecret(Buffer.alloc(32, 2), 'pw');
      await saveKeystore({ version: 1, chain: 'base', address: '0xb', name: 'trading', encryption: enc });
      const loaded = await loadKeystore('base', 'trading');
      expect(loaded.address).toBe('0xb');
      expect(loaded.name).toBe('trading');
    });

    it('default name uses <chain>-default.json', async () => {
      const enc = await encryptSecret(Buffer.alloc(32, 3), 'pw');
      await saveKeystore({ version: 1, chain: 'solana', address: 'SoLA1', encryption: enc });
      const loaded = await loadKeystore('solana');
      expect(loaded.address).toBe('SoLA1');
    });

    it('loadKeystore falls back to legacy <chain>.json when default is requested but missing', async () => {
      await makeKeystore('base.json', 'base');
      const loaded = await loadKeystore('base');
      expect(loaded.chain).toBe('base');
    });

    it('loadKeystore does NOT fall back to legacy for non-default names', async () => {
      await makeKeystore('base.json', 'base');
      await expect(loadKeystore('base', 'trading')).rejects.toThrow();
    });

    it('keystoreExists returns true for legacy default keystore', async () => {
      await makeKeystore('tempo.json', 'tempo');
      expect(await keystoreExists('tempo')).toBe(true);
      expect(await keystoreExists('tempo', 'extra')).toBe(false);
    });

    it('listWallets enumerates named wallets per chain', async () => {
      const enc = await encryptSecret(Buffer.alloc(32, 9), 'pw');
      await saveKeystore({ version: 1, chain: 'base', address: '0x1', name: 'default', encryption: enc });
      await saveKeystore({ version: 1, chain: 'base', address: '0x2', name: 'trading', encryption: enc });
      await saveKeystore({ version: 1, chain: 'solana', address: 'SoL', name: 'default', encryption: enc });
      const baseList = await listWallets('base');
      expect(baseList).toEqual(['default', 'trading']);
      const solList = await listWallets('solana');
      expect(solList).toEqual(['default']);
      const tempoList = await listWallets('tempo');
      expect(tempoList).toEqual([]);
    });

    it('listWallets surfaces a legacy keystore as the default name', async () => {
      await makeKeystore('base.json', 'base');
      expect(await listWallets('base')).toEqual(['default']);
    });

    it('listWallets handles missing wallets dir', async () => {
      await rm(join(ROOT, '.agentscore', 'wallets'), { recursive: true, force: true });
      expect(await listWallets('base')).toEqual([]);
    });

    it('listWallets does not leak across chains (tempo-base.json is a tempo wallet, not a base one)', async () => {
      const enc = await encryptSecret(Buffer.alloc(32, 9), 'pw');
      await saveKeystore({ version: 1, chain: 'tempo', address: '0xt', name: 'base', encryption: enc });
      expect(await listWallets('base')).toEqual([]);
      expect(await listWallets('tempo')).toEqual(['base']);
    });

    it('rejects invalid wallet names on save and load', async () => {
      const enc = await encryptSecret(Buffer.alloc(32, 1), 'pw');
      await expect(
        saveKeystore({ version: 1, chain: 'base', address: '0x', name: '../escape', encryption: enc }),
      ).rejects.toThrow();
      await expect(loadKeystore('base', '../escape')).rejects.toThrow();
    });

    describe('deleteKeystore', () => {
      it('removes a named keystore and reports the removed paths', async () => {
        const enc = await encryptSecret(Buffer.alloc(32, 1), 'pw');
        await saveKeystore({ version: 1, chain: 'base', address: '0xa', name: 'trading', encryption: enc });
        const removed = await deleteKeystore('base', 'trading');
        expect(removed).toHaveLength(1);
        expect(removed[0]).toMatch(/base-trading\.json$/);
        expect(await keystoreExists('base', 'trading')).toBe(false);
      });

      it('removes both legacy and new default paths when deleting "default"', async () => {
        await makeKeystore('base.json', 'base');
        const enc = await encryptSecret(Buffer.alloc(32, 2), 'pw');
        await saveKeystore({ version: 1, chain: 'base', address: '0xb', name: 'default', encryption: enc });
        const removed = await deleteKeystore('base');
        expect(removed.some((p) => p.endsWith('base-default.json'))).toBe(true);
        expect(removed.some((p) => p.endsWith('base.json'))).toBe(true);
      });

      it('is a no-op when the keystore does not exist', async () => {
        const removed = await deleteKeystore('base', 'never-existed');
        expect(removed).toEqual([]);
      });

      it('rejects invalid wallet names', async () => {
        await expect(deleteKeystore('base', '../escape')).rejects.toThrow();
      });
    });
  });
});
