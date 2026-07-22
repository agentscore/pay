import { createPublicClient, createWalletClient, erc20Abi, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { tempo, tempoModerato } from 'viem/chains';
import { evmConfig, type Network } from '../constants';
import { CliError, wrapRpcError } from '../errors';
import { confirmEvmTransfer, isEvmRevert, transferRevertedError } from './evm-confirm';

type Hex = `0x${string}`;

function chainFor(network: Network) {
  return network === 'mainnet' ? tempo : tempoModerato;
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
  } catch (err: unknown) {
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

export async function nativeBalance(address: string, network: Network = 'mainnet'): Promise<bigint> {
  const cfg = evmConfig('tempo', network);
  const publicClient = createPublicClient({ chain: chainFor(network), transport: http(cfg.rpcUrl) });
  try {
    return await publicClient.getBalance({ address: address as Hex });
  } catch (err: unknown) {
    throw wrapRpcError('tempo', network, err);
  }
}

export function formatNative(raw: bigint): string {
  // Tempo native token (TEMPO) is 18-decimal. Match base.formatNative.
  const whole = raw / 10n ** 18n;
  const frac = raw % 10n ** 18n;
  const fracPadded = frac.toString().padStart(18, '0').slice(0, 6);
  return `${whole.toString()}.${fracPadded}`;
}

export const NATIVE_SYMBOL = 'TEMPO';

export async function transferNative(input: {
  key: Buffer;
  to: string;
  amountNative: number;
  network?: Network;
}): Promise<{ tx_hash: string; from: string; to: string; amount_native: string }> {
  const network = input.network ?? 'mainnet';
  const cfg = evmConfig('tempo', network);
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
    await confirmEvmTransfer(wallet, txHash, { chain: 'tempo', network, asset: 'native' });
    return {
      tx_hash: txHash,
      from: account.address,
      to: input.to,
      amount_native: formatNative(amount),
    };
  } catch (err: unknown) {
    if (isEvmRevert(err)) throw transferRevertedError({ chain: 'tempo', network, asset: 'native' });
    throw wrapRpcError('tempo', network, err);
  }
}

export async function transfer(input: {
  key: Buffer;
  to: string;
  amountUsd: number;
  network?: Network;
}): Promise<{ tx_hash: string; from: string; to: string; amount_usdc: string }> {
  const network = input.network ?? 'mainnet';
  const cfg = evmConfig('tempo', network);
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
    await confirmEvmTransfer(wallet, txHash, { chain: 'tempo', network, asset: 'usdc' });
    return {
      tx_hash: txHash,
      from: account.address,
      to: input.to,
      amount_usdc: formatBalance(amount),
    };
  } catch (err: unknown) {
    if (isEvmRevert(err)) throw transferRevertedError({ chain: 'tempo', network, asset: 'usdc' });
    throw wrapRpcError('tempo', network, err);
  }
}

/**
 * Calls Moderato testnet's `tempo_fundAddress` JSON-RPC method, which mints
 * test stablecoins (pathUSD, AlphaUSD, BetaUSD, ThetaUSD) to the address.
 * Testnet only — mainnet has no programmatic faucet.
 */
export async function fundTestnet(address: string): Promise<string[]> {
  const cfg = evmConfig('tempo', 'testnet');
  let res: Response;
  try {
    res = await fetch(cfg.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tempo_fundAddress',
        params: [address],
        id: 1,
      }),
    });
  } catch (err: unknown) {
    throw wrapRpcError('tempo', 'testnet', err);
  }
  let body: { result?: string[]; error?: { code: number; message: string } };
  try {
    body = (await res.json()) as typeof body;
  } catch (err: unknown) {
    throw wrapRpcError('tempo', 'testnet', err);
  }
  if (body.error) {
    throw new CliError('rpc_error', `tempo_fundAddress failed: ${body.error.message}`, {
      extra: { rpc_code: body.error.code, address },
    });
  }
  if (!Array.isArray(body.result)) {
    throw new CliError('rpc_error', 'tempo_fundAddress returned no transaction hashes.', {
      extra: { body, address },
    });
  }
  return body.result;
}
