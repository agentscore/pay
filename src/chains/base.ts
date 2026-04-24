import { createPublicClient, erc20Abi, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { USDC } from '../constants';

type Hex = `0x${string}`;

export function generateKey(): Buffer {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
}

export function keyToAddress(key: Buffer): string {
  const hex = ('0x' + key.toString('hex')) as Hex;
  return privateKeyToAccount(hex).address;
}

export function createSigner(key: Buffer) {
  const hex = ('0x' + key.toString('hex')) as Hex;
  const account = privateKeyToAccount(hex);
  const transport = http(USDC.base.mainnet.rpcUrl);
  const publicClient = createPublicClient({ chain: base, transport });
  return {
    address: account.address,
    signTypedData: account.signTypedData.bind(account),
    readContract: publicClient.readContract.bind(publicClient),
  };
}

export async function balance(address: string): Promise<bigint> {
  const publicClient = createPublicClient({
    chain: base,
    transport: http(USDC.base.mainnet.rpcUrl),
  }).extend(publicActions);
  return publicClient.readContract({
    address: USDC.base.mainnet.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address as Hex],
  });
}

export function qrUri(address: string, amountUsd?: number): string {
  if (!amountUsd || amountUsd <= 0) return address;
  const amount = BigInt(Math.round(amountUsd * 10 ** USDC.base.mainnet.decimals));
  return `ethereum:${USDC.base.mainnet.address}@${USDC.base.mainnet.chainId}/transfer?address=${address}&uint256=${amount}`;
}

export function formatBalance(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const frac = raw % 1_000_000n;
  return `${whole.toString()}.${frac.toString().padStart(6, '0')}`;
}
