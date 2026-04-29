import { saveConfig } from '../config';
import { SUPPORTED_CHAINS, type Chain, type Network } from '../constants';
import { CliError } from '../errors';
import { keystoreExists } from '../keystore';
import { mnemonicExists, mnemonicPath } from '../mnemonic-store';
import { fund } from './fund';
import { walletCreate } from './wallet';

export interface InitInput {
  mnemonic?: boolean;
  fundTempoTestnet?: boolean;
  preferredChains?: string;
  network?: Network;
}

export interface InitResult {
  ok: true;
  already_initialized?: boolean;
  existing_wallets?: Chain[];
  created_for?: Chain[];
  preferred_chains?: Chain[];
  tempo_testnet_funded?: boolean;
  tempo_testnet_fund_error?: string;
}

export async function init(input: InitInput = {}): Promise<InitResult> {
  const useMnemonic = input.mnemonic ?? true;

  const existingWallets: Chain[] = [];
  for (const c of SUPPORTED_CHAINS) {
    if (await keystoreExists(c)) existingWallets.push(c);
  }

  if (existingWallets.length === SUPPORTED_CHAINS.length) {
    return { ok: true, already_initialized: true, existing_wallets: existingWallets };
  }

  const hasMnemonic = await mnemonicExists();
  if (useMnemonic && hasMnemonic) {
    throw new CliError('wallet_exists', 'A mnemonic is already stored. Re-run with --no-mnemonic to create raw keys for missing chains, or remove the existing mnemonic first.', {
      nextSteps: {
        action: 'inspect_or_remove_mnemonic',
        suggestion: 'Use `wallet show-mnemonic --danger` to view, or delete the mnemonic file to start fresh.',
      },
    });
  }
  if (!useMnemonic && hasMnemonic && existingWallets.length < SUPPORTED_CHAINS.length) {
    throw new CliError(
      'wallet_exists',
      'A mnemonic is stored but some chains are missing keystores. Adding random keys would leave the mnemonic out of sync with the on-disk wallets.',
      {
        nextSteps: {
          action: 'recover_from_mnemonic_or_clear',
          suggestion: `Either re-derive the missing chains with \`wallet import --mnemonic "<phrase>"\` (after \`wallet show-mnemonic --danger\`), or remove ${mnemonicPath()} to forfeit the global mnemonic.`,
        },
        extra: { mnemonic_path: mnemonicPath(), existing_wallets: existingWallets },
      },
    );
  }

  await walletCreate({ mnemonic: useMnemonic });
  const created_for = SUPPORTED_CHAINS.filter((c) => !existingWallets.includes(c));

  const result: InitResult = { ok: true, created_for };

  if (input.preferredChains) {
    const chains = parsePreferredChains(input.preferredChains);
    await saveConfig({ preferred_chains: chains });
    result.preferred_chains = chains;
  }

  if (input.fundTempoTestnet) {
    try {
      await fund({ chain: 'tempo', network: 'testnet' });
      result.tempo_testnet_funded = true;
    } catch (err: unknown) {
      result.tempo_testnet_funded = false;
      result.tempo_testnet_fund_error = err instanceof Error ? err.message : String(err);
    }
  }

  return result;
}

function parsePreferredChains(value: string): Chain[] {
  const chains = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const c of chains) {
    if (!(SUPPORTED_CHAINS as readonly string[]).includes(c)) {
      throw new CliError('config_error', `Unsupported chain: ${c}`, {
        extra: { valid_chains: [...SUPPORTED_CHAINS] },
      });
    }
  }
  return chains as Chain[];
}
