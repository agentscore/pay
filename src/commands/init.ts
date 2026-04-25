import { bold, dim, green, yellow } from '../colors';
import { saveConfig } from '../config';
import { SUPPORTED_CHAINS, type Chain, type Network } from '../constants';
import { CliError } from '../errors';
import { keystoreExists } from '../keystore';
import { mnemonicExists, mnemonicPath } from '../mnemonic-store';
import { isJson, writeHumanNote, writeJson } from '../output';
import { fund } from './fund';
import { walletCreate } from './wallet';

export interface InitOptions {
  mnemonic?: boolean;
  fundTempoTestnet?: boolean;
  preferredChains?: string;
  network?: Network;
}

export async function init(opts: InitOptions = {}): Promise<void> {
  const useMnemonic = opts.mnemonic ?? true;

  const existingWallets: Chain[] = [];
  for (const c of SUPPORTED_CHAINS) {
    if (await keystoreExists(c)) existingWallets.push(c);
  }

  if (existingWallets.length === SUPPORTED_CHAINS.length) {
    if (isJson()) {
      writeJson({
        ok: true,
        already_initialized: true,
        existing_wallets: existingWallets,
      });
      return;
    }
    writeHumanNote('All wallets already exist. Use `whoami` to inspect or `wallet create --chain <c>` to add.');
    return;
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

  if (!isJson()) writeHumanNote('Creating wallets for base, solana, tempo' + (useMnemonic ? ' from a single BIP-39 mnemonic' : ' (random keys per chain)') + '...');

  await walletCreate({ mnemonic: useMnemonic });

  if (opts.preferredChains) {
    const chains = parsePreferredChains(opts.preferredChains);
    await saveConfig({ preferred_chains: chains });
    if (!isJson()) writeHumanNote(`${green('✓')} preferred_chains set to ${bold(chains.join(','))}`);
  }

  if (opts.fundTempoTestnet) {
    if (!isJson()) writeHumanNote('\nFunding Tempo testnet wallet via tempo_fundAddress...');
    try {
      await fund('tempo', undefined, 'testnet');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isJson()) {
        writeJson({ event: 'fund_tempo_testnet_failed', error: msg });
      } else {
        writeHumanNote(yellow(`(tempo testnet fund failed: ${msg} — wallets are still created; rerun \`fund --chain tempo --network testnet\` later)`));
      }
    }
  }

  if (!isJson()) {
    writeHumanNote('');
    writeHumanNote(bold('Initialized. Next steps:'));
    writeHumanNote(dim('  agentscore-pay whoami                   # see addresses + balances'));
    writeHumanNote(dim('  agentscore-pay fund --chain base        # top up via Coinbase Onramp'));
    writeHumanNote(dim('  agentscore-pay limits set --daily 50    # cap autonomous spend'));
    writeHumanNote(dim('  agentscore-pay pay POST <url> -d <body> # spend'));
  }
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
