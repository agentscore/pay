import {
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  address as solAddress,
} from '@solana/kit';
import { fetchToken } from '@solana-program/token';
import { svmConfig, type Network } from '../constants';
import { wrapRpcError } from '../errors';

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

export async function balance(ownerBase58: string, network: Network = 'mainnet'): Promise<bigint> {
  const cfg = svmConfig(network);
  const rpc = createSolanaRpc(cfg.rpcUrl);
  const owner = solAddress(ownerBase58);
  const mint = solAddress(cfg.mint);
  try {
    const accounts = await rpc
      .getTokenAccountsByOwner(owner, { mint }, { encoding: 'base64' })
      .send();
    if (!accounts.value.length) return 0n;
    const ata = accounts.value[0].pubkey;
    const token = await fetchToken(rpc, ata);
    return token.data.amount;
  } catch (err: unknown) {
    throw wrapRpcError('solana', network, err);
  }
}

export function qrUri(addr: string, amountUsd?: number, network: Network = 'mainnet'): string {
  const cfg = svmConfig(network);
  const base = `solana:${addr}`;
  if (!amountUsd || amountUsd <= 0) return base;
  const params = new URLSearchParams({
    amount: amountUsd.toFixed(cfg.decimals),
    'spl-token': cfg.mint,
  });
  return `${base}?${params.toString()}`;
}

export function formatBalance(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const frac = raw % 1_000_000n;
  return `${whole.toString()}.${frac.toString().padStart(6, '0')}`;
}
