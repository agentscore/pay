import { createWalletClient, erc20Abi, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia, tempo, tempoModerato } from 'viem/chains';
import { evmConfig, type Chain, type Network } from '../constants';
import { CliError, wrapRpcError } from '../errors';
import { DEFAULT_WALLET_NAME } from '../paths';
import { promptPassphrase } from '../prompts';
import { loadWallet } from '../wallets';

type Hex = `0x${string}`;

export interface RevokeInput {
  chain: Chain;
  network?: Network;
  token: string;
  spender: string;
  name?: string;
}

export interface RevokeResult {
  ok: true;
  chain: Chain;
  network: Network;
  signer: string;
  token: string;
  spender: string;
  tx_hash: string;
}

function isHexAddress(s: string): s is Hex {
  return /^0x[0-9a-fA-F]{40}$/.test(s);
}

function viemChainFor(chain: Chain, network: Network) {
  if (chain === 'base') return network === 'mainnet' ? base : baseSepolia;
  if (chain === 'tempo') return network === 'mainnet' ? tempo : tempoModerato;
  throw new CliError('unsupported_rail', `revoke is only supported on EVM chains (base, tempo). Got: ${chain}`);
}

export async function revoke(input: RevokeInput): Promise<RevokeResult> {
  if (input.chain === 'solana') {
    throw new CliError('unsupported_rail', 'revoke is not yet implemented for Solana SPL tokens. EVM chains only (base, tempo).');
  }
  if (!isHexAddress(input.token)) {
    throw new CliError('invalid_input', `--token must be a 0x-prefixed 40-hex EVM address. Got: ${input.token}`);
  }
  if (!isHexAddress(input.spender)) {
    throw new CliError('invalid_input', `--spender must be a 0x-prefixed 40-hex EVM address. Got: ${input.spender}`);
  }

  const network: Network = input.network ?? 'mainnet';
  const cfg = evmConfig(input.chain, network);
  const passphrase = await promptPassphrase();
  const wallet = await loadWallet(input.chain, passphrase, input.name ?? DEFAULT_WALLET_NAME);
  const account = privateKeyToAccount(('0x' + wallet.secret.toString('hex')) as Hex);
  const client = createWalletClient({
    account,
    chain: viemChainFor(input.chain, network),
    transport: http(cfg.rpcUrl),
  });

  let hash: Hex;
  try {
    hash = await client.writeContract({
      address: input.token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [input.spender, 0n],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/insufficient funds|gas|fee/i.test(msg)) {
      throw new CliError('insufficient_balance', `${input.chain} wallet has no native gas to send the revoke transaction.`, {
        nextSteps: {
          action: 'fund_native_gas',
          suggestion: `Send a small amount of ${input.chain === 'base' ? 'ETH on Base' : 'TEMPO native token'} to ${wallet.address} and retry. x402/MPP payments don't need this; only on-chain writes do.`,
        },
        extra: { chain: input.chain, signer: wallet.address, original_message: msg },
      });
    }
    throw wrapRpcError(input.chain, network, err);
  }

  return {
    ok: true,
    chain: input.chain,
    network,
    signer: wallet.address,
    token: input.token,
    spender: input.spender,
    tx_hash: hash,
  };
}
