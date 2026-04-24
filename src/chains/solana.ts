import {
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  address as solAddress,
} from '@solana/kit';
import { fetchToken } from '@solana-program/token';
import { USDC } from '../constants';

export function generateKey(): Buffer {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
}

export async function keyToAddress(key: Buffer): Promise<string> {
  const signer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(key));
  return signer.address;
}

export async function createSigner(key: Buffer) {
  return createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(key));
}

export async function balance(ownerBase58: string): Promise<bigint> {
  const rpc = createSolanaRpc(USDC.solana.mainnet.rpcUrl);
  const owner = solAddress(ownerBase58);
  const mint = solAddress(USDC.solana.mainnet.mint);
  const accounts = await rpc
    .getTokenAccountsByOwner(owner, { mint }, { encoding: 'base64' })
    .send();
  if (!accounts.value.length) return 0n;
  const ata = accounts.value[0].pubkey;
  const token = await fetchToken(rpc, ata);
  return token.data.amount;
}

export function qrUri(addr: string, amountUsd?: number): string {
  const base = `solana:${addr}`;
  if (!amountUsd || amountUsd <= 0) return base;
  const params = new URLSearchParams({
    amount: amountUsd.toFixed(USDC.solana.mainnet.decimals),
    'spl-token': USDC.solana.mainnet.mint,
  });
  return `${base}?${params.toString()}`;
}

export function formatBalance(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const frac = raw % 1_000_000n;
  return `${whole.toString()}.${frac.toString().padStart(6, '0')}`;
}
