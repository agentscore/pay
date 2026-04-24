import * as base from './chains/base';
import * as solana from './chains/solana';
import { decryptSecret, keystoreExists, loadKeystore, saveKeystore } from './keystore';
import type { Chain } from './constants';

export interface Wallet {
  chain: Chain;
  address: string;
  secret: Buffer;
}

export async function createWallet(chain: Chain, passphrase: string, existing?: Buffer): Promise<Wallet> {
  if (await keystoreExists(chain)) {
    throw new Error(`Keystore for ${chain} already exists. Delete ~/.agentscore/wallets/${chain}.json to regenerate.`);
  }
  const secret = existing ?? (chain === 'base' ? base.generateKey() : solana.generateKey());
  const address = chain === 'base' ? base.keyToAddress(secret) : await solana.keyToAddress(secret);
  const encryption = await (await import('./keystore')).encryptSecret(secret, passphrase);
  await saveKeystore({ version: 1, chain, address, encryption });
  return { chain, address, secret };
}

export async function loadWallet(chain: Chain, passphrase: string): Promise<Wallet> {
  const file = await loadKeystore(chain);
  const secret = await decryptSecret(file.encryption, passphrase);
  return { chain, address: file.address, secret };
}

export async function getBalance(wallet: Wallet): Promise<bigint> {
  return wallet.chain === 'base' ? base.balance(wallet.address) : solana.balance(wallet.address);
}

export async function getQrUri(wallet: Wallet, amountUsd?: number): Promise<string> {
  return wallet.chain === 'base' ? base.qrUri(wallet.address, amountUsd) : solana.qrUri(wallet.address, amountUsd);
}

export function formatBalance(chain: Chain, raw: bigint): string {
  return chain === 'base' ? base.formatBalance(raw) : solana.formatBalance(raw);
}

export async function createX402Signer(wallet: Wallet): Promise<unknown> {
  if (wallet.chain === 'base') return base.createSigner(wallet.secret);
  return solana.createSigner(wallet.secret);
}
