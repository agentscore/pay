import * as base from './chains/base';
import * as solana from './chains/solana';
import * as tempo from './chains/tempo';
import { decryptSecret, encryptSecret, keystoreExists, loadKeystore, saveKeystore } from './keystore';
import type { Chain, Network } from './constants';

export interface Wallet {
  chain: Chain;
  address: string;
  secret: Buffer;
}

function generateKey(chain: Chain): Buffer {
  if (chain === 'base') return base.generateKey();
  if (chain === 'solana') return solana.generateKey();
  return tempo.generateKey();
}

async function deriveAddress(chain: Chain, secret: Buffer): Promise<string> {
  if (chain === 'base') return base.keyToAddress(secret);
  if (chain === 'solana') return solana.keyToAddress(secret);
  return tempo.keyToAddress(secret);
}

export async function createWallet(chain: Chain, passphrase: string, existing?: Buffer): Promise<Wallet> {
  if (await keystoreExists(chain)) {
    throw new Error(
      `Keystore for ${chain} already exists. Delete ~/.agentscore/wallets/${chain}.json to regenerate.`,
    );
  }
  const secret = existing ?? generateKey(chain);
  const address = await deriveAddress(chain, secret);
  const encryption = await encryptSecret(secret, passphrase);
  await saveKeystore({ version: 1, chain, address, encryption });
  return { chain, address, secret };
}

export async function loadWallet(chain: Chain, passphrase: string): Promise<Wallet> {
  const file = await loadKeystore(chain);
  const secret = await decryptSecret(file.encryption, passphrase);
  return { chain, address: file.address, secret };
}

export async function getBalance(wallet: Wallet, network: Network = 'mainnet'): Promise<bigint> {
  if (wallet.chain === 'base') return base.balance(wallet.address, network);
  if (wallet.chain === 'solana') return solana.balance(wallet.address, network);
  return tempo.balance(wallet.address, network);
}

export function getQrUri(wallet: Wallet, amountUsd?: number, network: Network = 'mainnet'): string {
  if (wallet.chain === 'base') return base.qrUri(wallet.address, amountUsd, network);
  if (wallet.chain === 'solana') return solana.qrUri(wallet.address, amountUsd, network);
  return tempo.qrUri(wallet.address, amountUsd, network);
}

export function formatBalance(chain: Chain, raw: bigint): string {
  if (chain === 'base') return base.formatBalance(raw);
  if (chain === 'solana') return solana.formatBalance(raw);
  return tempo.formatBalance(raw);
}

export async function createX402Signer(wallet: Wallet, network: Network = 'mainnet'): Promise<unknown> {
  if (wallet.chain === 'base') return base.createSigner(wallet.secret, network);
  if (wallet.chain === 'solana') return solana.createSigner(wallet.secret);
  throw new Error(`x402 signer not applicable for chain: ${wallet.chain}`);
}

export function createMppAccount(wallet: Wallet) {
  if (wallet.chain !== 'tempo') throw new Error(`MPP account not applicable for chain: ${wallet.chain}`);
  return tempo.createAccount(wallet.secret);
}
