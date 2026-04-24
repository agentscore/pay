import { createPublicClient, defineChain, erc20Abi, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { USDC } from '../constants';

type Hex = `0x${string}`;

const tempoMainnet = defineChain({
  id: USDC.tempo.mainnet.chainId,
  name: 'Tempo',
  nativeCurrency: { name: 'Tempo', symbol: 'TEMPO', decimals: 18 },
  rpcUrls: { default: { http: [USDC.tempo.mainnet.rpcUrl] } },
});

export function generateKey(): Buffer {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
}

export function keyToAddress(key: Buffer): string {
  const hex = ('0x' + key.toString('hex')) as Hex;
  return privateKeyToAccount(hex).address;
}

export function createAccount(key: Buffer) {
  const hex = ('0x' + key.toString('hex')) as Hex;
  return privateKeyToAccount(hex);
}

export async function balance(address: string): Promise<bigint> {
  const publicClient = createPublicClient({
    chain: tempoMainnet,
    transport: http(USDC.tempo.mainnet.rpcUrl),
  });
  return publicClient.readContract({
    address: USDC.tempo.mainnet.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address as Hex],
  });
}

export function qrUri(address: string, amountUsd?: number): string {
  if (!amountUsd || amountUsd <= 0) return address;
  const amount = BigInt(Math.round(amountUsd * 10 ** USDC.tempo.mainnet.decimals));
  return `ethereum:${USDC.tempo.mainnet.address}@${USDC.tempo.mainnet.chainId}/transfer?address=${address}&uint256=${amount}`;
}

export function formatBalance(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const frac = raw % 1_000_000n;
  return `${whole.toString()}.${frac.toString().padStart(6, '0')}`;
}
