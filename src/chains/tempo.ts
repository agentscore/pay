import { createPublicClient, defineChain, erc20Abi, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { evmConfig, type Network } from '../constants';
import { wrapRpcError } from '../errors';

type Hex = `0x${string}`;

function chainFor(network: Network) {
  const cfg = evmConfig('tempo', network);
  return defineChain({
    id: cfg.chainId,
    name: network === 'mainnet' ? 'Tempo' : 'Tempo Testnet',
    nativeCurrency: { name: 'Tempo', symbol: 'TEMPO', decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
}

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

export async function balance(address: string, network: Network = 'mainnet'): Promise<bigint> {
  const cfg = evmConfig('tempo', network);
  const publicClient = createPublicClient({
    chain: chainFor(network),
    transport: http(cfg.rpcUrl),
  });
  try {
    return await publicClient.readContract({
      address: cfg.address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address as Hex],
    });
  } catch (err) {
    throw wrapRpcError('tempo', network, err);
  }
}

export function qrUri(address: string, amountUsd?: number, network: Network = 'mainnet'): string {
  const cfg = evmConfig('tempo', network);
  if (!amountUsd || amountUsd <= 0) return address;
  const amount = BigInt(Math.round(amountUsd * 10 ** cfg.decimals));
  return `ethereum:${cfg.address}@${cfg.chainId}/transfer?address=${address}&uint256=${amount}`;
}

export function formatBalance(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const frac = raw % 1_000_000n;
  return `${whole.toString()}.${frac.toString().padStart(6, '0')}`;
}
