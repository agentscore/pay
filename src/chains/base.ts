import { createPublicClient, createWalletClient, erc20Abi, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { evmConfig, type Network } from '../constants';
import { wrapRpcError } from '../errors';
import { confirmEvmTransfer, isEvmRevert, transferRevertedError } from './evm-confirm';

type Hex = `0x${string}`;

function chainFor(network: Network) {
  return network === 'mainnet' ? base : baseSepolia;
}

export function generateKey(): Buffer {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
}

export function keyToAddress(key: Buffer): string {
  const hex = ('0x' + key.toString('hex')) as Hex;
  return privateKeyToAccount(hex).address;
}

export function createSigner(key: Buffer, network: Network = 'mainnet') {
  const hex = ('0x' + key.toString('hex')) as Hex;
  const account = privateKeyToAccount(hex);
  const cfg = evmConfig('base', network);
  const transport = http(cfg.rpcUrl);
  const publicClient = createPublicClient({ chain: chainFor(network), transport });
  return {
    address: account.address,
    signTypedData: account.signTypedData.bind(account),
    readContract: publicClient.readContract.bind(publicClient),
  };
}

export async function balance(address: string, network: Network = 'mainnet'): Promise<bigint> {
  const cfg = evmConfig('base', network);
  const publicClient = createPublicClient({
    chain: chainFor(network),
    transport: http(cfg.rpcUrl),
  }).extend(publicActions);
  try {
    return await publicClient.readContract({
      address: cfg.address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address as Hex],
    });
  } catch (err: unknown) {
    throw wrapRpcError('base', network, err);
  }
}

export function qrUri(address: string, amountUsd?: number, network: Network = 'mainnet'): string {
  const cfg = evmConfig('base', network);
  if (!amountUsd || amountUsd <= 0) return address;
  const amount = BigInt(Math.round(amountUsd * 10 ** cfg.decimals));
  return `ethereum:${cfg.address}@${cfg.chainId}/transfer?address=${address}&uint256=${amount}`;
}

export function formatBalance(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const frac = raw % 1_000_000n;
  return `${whole.toString()}.${frac.toString().padStart(6, '0')}`;
}

export async function nativeBalance(address: string, network: Network = 'mainnet'): Promise<bigint> {
  const cfg = evmConfig('base', network);
  const publicClient = createPublicClient({ chain: chainFor(network), transport: http(cfg.rpcUrl) });
  try {
    return await publicClient.getBalance({ address: address as Hex });
  } catch (err: unknown) {
    throw wrapRpcError('base', network, err);
  }
}

export function formatNative(raw: bigint): string {
  // 18-decimal ETH; show 6 significant fractional digits to keep output readable.
  const whole = raw / 10n ** 18n;
  const frac = raw % 10n ** 18n;
  const fracPadded = frac.toString().padStart(18, '0').slice(0, 6);
  return `${whole.toString()}.${fracPadded}`;
}

export const NATIVE_SYMBOL = 'ETH';

export async function transferNative(input: {
  key: Buffer;
  to: string;
  amountNative: number;
  network?: Network;
}): Promise<{ tx_hash: string; from: string; to: string; amount_native: string }> {
  const network = input.network ?? 'mainnet';
  const cfg = evmConfig('base', network);
  const hex = ('0x' + input.key.toString('hex')) as Hex;
  const account = privateKeyToAccount(hex);
  const wallet = createWalletClient({
    account,
    chain: chainFor(network),
    transport: http(cfg.rpcUrl),
  }).extend(publicActions);
  const amount = BigInt(Math.round(input.amountNative * 10 ** 18));
  try {
    const txHash = await wallet.sendTransaction({
      to: input.to as Hex,
      value: amount,
    });
    await confirmEvmTransfer(wallet, txHash, { chain: 'base', network, asset: 'native' });
    return {
      tx_hash: txHash,
      from: account.address,
      to: input.to,
      amount_native: formatNative(amount),
    };
  } catch (err: unknown) {
    if (isEvmRevert(err)) throw transferRevertedError({ chain: 'base', network, asset: 'native' });
    throw wrapRpcError('base', network, err);
  }
}

export async function transfer(input: {
  key: Buffer;
  to: string;
  amountUsd: number;
  network?: Network;
}): Promise<{ tx_hash: string; from: string; to: string; amount_usdc: string }> {
  const network = input.network ?? 'mainnet';
  const cfg = evmConfig('base', network);
  const hex = ('0x' + input.key.toString('hex')) as Hex;
  const account = privateKeyToAccount(hex);
  const wallet = createWalletClient({
    account,
    chain: chainFor(network),
    transport: http(cfg.rpcUrl),
  }).extend(publicActions);
  const amount = BigInt(Math.round(input.amountUsd * 10 ** cfg.decimals));
  try {
    const txHash = await wallet.writeContract({
      address: cfg.address,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [input.to as Hex, amount],
    });
    await confirmEvmTransfer(wallet, txHash, { chain: 'base', network, asset: 'usdc' });
    return {
      tx_hash: txHash,
      from: account.address,
      to: input.to,
      amount_usdc: formatBalance(amount),
    };
  } catch (err: unknown) {
    if (isEvmRevert(err)) throw transferRevertedError({ chain: 'base', network, asset: 'usdc' });
    throw wrapRpcError('base', network, err);
  }
}
