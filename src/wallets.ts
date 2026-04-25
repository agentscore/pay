import * as base from './chains/base';
import * as solana from './chains/solana';
import * as tempo from './chains/tempo';
import { CliError } from './errors';
import { decryptSecret, encryptSecret, keystoreExists, loadKeystore, saveKeystore } from './keystore';
import { DEFAULT_WALLET_NAME } from './paths';
import type { Chain, Network } from './constants';

export interface Wallet {
  chain: Chain;
  address: string;
  secret: Buffer;
  name?: string;
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

export async function createWallet(
  chain: Chain,
  passphrase: string,
  existing?: Buffer,
  name: string = DEFAULT_WALLET_NAME,
): Promise<Wallet> {
  if (await keystoreExists(chain, name)) {
    const suffix = name === DEFAULT_WALLET_NAME ? `${chain}.json` : `${chain}-${name}.json`;
    throw new Error(
      `Keystore for ${chain} (${name}) already exists. Delete ~/.agentscore/wallets/${suffix} to regenerate.`,
    );
  }
  const secret = existing ?? generateKey(chain);
  const address = await deriveAddress(chain, secret);
  const encryption = await encryptSecret(secret, passphrase);
  await saveKeystore({ version: 1, chain, address, name, encryption });
  return { chain, address, secret, name };
}

export async function loadWallet(
  chain: Chain,
  passphrase: string,
  name: string = DEFAULT_WALLET_NAME,
): Promise<Wallet> {
  const file = await loadKeystore(chain, name);
  let secret: Buffer;
  try {
    secret = await decryptSecret(file.encryption, passphrase);
  } catch {
    throw new CliError('wrong_passphrase', `Failed to decrypt ${chain} (${name}) keystore with the provided passphrase.`, {
      nextSteps: { action: 'retry_passphrase' },
      extra: { chain, name },
    });
  }
  return { chain, address: file.address, secret, name: file.name ?? name };
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
