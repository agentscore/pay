import * as baseChain from './chains/base';
import * as solanaChain from './chains/solana';
import * as tempoChain from './chains/tempo';
import { loadConfig } from './config';
import { SUPPORTED_CHAINS, type Chain, type Network } from './constants';
import { CliError } from './errors';
import { keystoreExists, loadKeystore } from './keystore';

export interface Candidate {
  chain: Chain;
  address: string;
  balance_raw: bigint;
  balance_usdc: string;
}

interface SelectInput {
  chainOverride?: Chain;
  minBalanceRaw?: bigint;
  network?: Network;
}

async function readBalance(chain: Chain, address: string, network: Network): Promise<bigint> {
  if (chain === 'base') return baseChain.balance(address, network);
  if (chain === 'solana') return solanaChain.balance(address, network);
  return tempoChain.balance(address, network);
}

function formatBalance(chain: Chain, raw: bigint): string {
  if (chain === 'base') return baseChain.formatBalance(raw);
  if (chain === 'solana') return solanaChain.formatBalance(raw);
  return tempoChain.formatBalance(raw);
}

export async function listHeldCandidates(network: Network = 'mainnet'): Promise<Candidate[]> {
  const chains = [...SUPPORTED_CHAINS];
  const candidates = await Promise.all(
    chains.map(async (chain) => {
      if (!(await keystoreExists(chain))) return null;
      const ks = await loadKeystore(chain);
      const raw = await readBalance(chain, ks.address, network);
      return {
        chain,
        address: ks.address,
        balance_raw: raw,
        balance_usdc: formatBalance(chain, raw),
      } satisfies Candidate;
    }),
  );
  return candidates.filter((c): c is Candidate => c !== null);
}

export async function selectRail(input: SelectInput = {}): Promise<Candidate> {
  const { chainOverride, minBalanceRaw, network = 'mainnet' } = input;
  const heldCandidates = await listHeldCandidates(network);

  if (heldCandidates.length === 0) {
    throw new CliError('no_wallet', 'No wallets on disk.', {
      nextSteps: {
        action: 'create_wallet',
        suggestion: 'Run `agentscore-pay wallet create` to generate keystores.',
      },
    });
  }

  const funded = minBalanceRaw !== undefined ? heldCandidates.filter((c) => c.balance_raw >= minBalanceRaw) : heldCandidates;

  if (chainOverride) {
    const hit = heldCandidates.find((c) => c.chain === chainOverride);
    if (!hit) {
      throw new CliError('no_wallet', `No wallet on disk for chain: ${chainOverride}.`, {
        nextSteps: {
          action: 'create_wallet',
          suggestion: `Run \`agentscore-pay wallet create --chain ${chainOverride}\`.`,
        },
        extra: { requested_chain: chainOverride, held_chains: heldCandidates.map((c) => c.chain) },
      });
    }
    if (minBalanceRaw !== undefined && hit.balance_raw < minBalanceRaw) {
      throw new CliError('insufficient_balance', `${chainOverride} wallet has insufficient USDC.`, {
        nextSteps: {
          action: 'fund_wallet',
          suggestion: `Run \`agentscore-pay fund --chain ${chainOverride}\`.`,
        },
        extra: { chain: chainOverride, balance_usdc: hit.balance_usdc, balance_raw: hit.balance_raw.toString() },
      });
    }
    return hit;
  }

  if (funded.length === 0) {
    throw new CliError('no_funded_rail', 'No funded wallet matches.', {
      nextSteps: {
        action: 'fund_wallet',
        suggestion: 'Run `agentscore-pay fund --chain <c>` to add USDC.',
      },
      extra: {
        held: heldCandidates.map((c) => ({ chain: c.chain, balance_usdc: c.balance_usdc })),
      },
    });
  }

  if (funded.length === 1) return funded[0];

  const config = await loadConfig();
  if (config.preferred_chains) {
    for (const pref of config.preferred_chains) {
      const hit = funded.find((c) => c.chain === pref);
      if (hit) return hit;
    }
  }

  throw new CliError('multi_rail_candidates', 'Multiple funded wallets match; specify --chain.', {
    nextSteps: {
      action: 'specify_chain',
      suggestion: 'Pass --chain <c> or set "preferred_chains" in ~/.agentscore/config.json.',
    },
    extra: {
      candidates: funded.map((c) => ({ chain: c.chain, address: c.address, balance_usdc: c.balance_usdc })),
    },
  });
}
