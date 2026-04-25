import { createWalletClient, erc20Abi, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia, tempo, tempoModerato } from 'viem/chains';
import { bold, cyan, dim, green, yellow } from '../colors';
import { evmConfig, type Chain, type Network } from '../constants';
import { CliError, wrapRpcError } from '../errors';
import { isJson, writeJson, writeLine } from '../output';
import { DEFAULT_WALLET_NAME } from '../paths';
import { promptPassphrase } from '../prompts';
import { loadWallet } from '../wallets';

type Hex = `0x${string}`;

export interface RevokeOptions {
  chain: Chain;
  network?: Network;
  token: string;
  spender: string;
  walletName?: string;
}

function isHexAddress(s: string): s is Hex {
  return /^0x[0-9a-fA-F]{40}$/.test(s);
}

function viemChainFor(chain: Chain, network: Network) {
  if (chain === 'base') return network === 'mainnet' ? base : baseSepolia;
  if (chain === 'tempo') return network === 'mainnet' ? tempo : tempoModerato;
  throw new CliError('unsupported_rail', `revoke is only supported on EVM chains (base, tempo). Got: ${chain}`);
}

export async function revoke(opts: RevokeOptions): Promise<void> {
  if (opts.chain === 'solana') {
    throw new CliError('unsupported_rail', 'revoke is not yet implemented for Solana SPL tokens. EVM chains only (base, tempo).');
  }
  if (!isHexAddress(opts.token)) {
    throw new CliError('invalid_input', `--token must be a 0x-prefixed 40-hex EVM address. Got: ${opts.token}`);
  }
  if (!isHexAddress(opts.spender)) {
    throw new CliError('invalid_input', `--spender must be a 0x-prefixed 40-hex EVM address. Got: ${opts.spender}`);
  }

  const network: Network = opts.network ?? 'mainnet';
  const cfg = evmConfig(opts.chain, network);
  const passphrase = await promptPassphrase();
  const wallet = await loadWallet(opts.chain, passphrase, opts.walletName ?? DEFAULT_WALLET_NAME);
  const account = privateKeyToAccount(('0x' + wallet.secret.toString('hex')) as Hex);
  const client = createWalletClient({
    account,
    chain: viemChainFor(opts.chain, network),
    transport: http(cfg.rpcUrl),
  });

  let hash: Hex;
  try {
    hash = await client.writeContract({
      address: opts.token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [opts.spender, 0n],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/insufficient funds|gas|fee/i.test(msg)) {
      throw new CliError('insufficient_balance', `${opts.chain} wallet has no native gas to send the revoke transaction.`, {
        nextSteps: {
          action: 'fund_native_gas',
          suggestion: `Send a small amount of ${opts.chain === 'base' ? 'ETH on Base' : 'TEMPO native token'} to ${wallet.address} and retry. x402/MPP payments don't need this; only on-chain writes do.`,
        },
        extra: { chain: opts.chain, signer: wallet.address, original_message: msg },
      });
    }
    throw wrapRpcError(opts.chain, network, err);
  }

  if (isJson()) {
    writeJson({
      ok: true,
      chain: opts.chain,
      network,
      signer: wallet.address,
      token: opts.token,
      spender: opts.spender,
      tx_hash: hash,
    });
    return;
  }
  writeLine(`${green('✓')} Revoke submitted on ${bold(opts.chain)} (${network}).`);
  writeLine(`  signer:   ${cyan(wallet.address)}`);
  writeLine(`  token:    ${cyan(opts.token)}`);
  writeLine(`  spender:  ${cyan(opts.spender)}`);
  writeLine(`  tx_hash:  ${bold(hash)}`);
  writeLine(dim('  (Re-check the allowance once the tx confirms; revoke is `approve(spender, 0)`.)'));
  writeLine('');
  writeLine(yellow('  Note: x402 + MPP do not use long-lived ERC-20 approvals. revoke matters for'));
  writeLine(yellow('  Permit2 / classic-allowance schemes if a payment scheme ever introduces them.'));
}
