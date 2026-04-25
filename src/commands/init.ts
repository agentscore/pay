import { bold, dim, green } from '../colors';
import { saveConfig } from '../config';
import { SUPPORTED_CHAINS, type Chain, type Network } from '../constants';
import { CliError } from '../errors';
import { keystoreExists } from '../keystore';
import { mnemonicExists } from '../mnemonic-store';
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

  if (useMnemonic && (await mnemonicExists())) {
    throw new CliError('wallet_exists', 'A mnemonic is already stored. Re-run with --no-mnemonic to create raw keys for missing chains, or remove the existing mnemonic first.', {
      nextSteps: {
        action: 'inspect_or_remove_mnemonic',
        suggestion: 'Use `wallet show-mnemonic --danger` to view, or delete the mnemonic file to start fresh.',
      },
    });
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
    await fund('tempo', undefined, 'testnet');
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
