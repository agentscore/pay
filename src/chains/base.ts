import { createPublicClient, erc20Abi, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { evmConfig, type Network } from '../constants';

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
  return publicClient.readContract({
    address: cfg.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address as Hex],
  });
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
