import { onrampUrl, SUPPORTED_CHAINS, type Chain } from '../constants';
import { CliError } from '../errors';
import { decryptSecret, deleteKeystore, keystoreExists, listWallets, loadKeystore } from '../keystore';
import { deriveKey, generatePhrase, validatePhrase } from '../mnemonic';
import { loadMnemonic, mnemonicExists, mnemonicPath, saveMnemonic } from '../mnemonic-store';
import { DEFAULT_WALLET_NAME, isValidWalletName, keystorePath } from '../paths';
import { promptNewPassphrase, promptPassphrase } from '../prompts';
import { clearCache as clearUnlockCache } from '../unlock-cache';
import { createWallet, getQrUri } from '../wallets';
import type { Wallet } from '../wallets';

function validateWalletName(name: string): void {
  if (!isValidWalletName(name)) {
    throw new CliError('invalid_input', `Invalid wallet name: "${name}". Use 1-32 alphanumerics or dashes.`, {
      nextSteps: { action: 'use_valid_name', suggestion: 'Examples: default, trading, agent-1' },
    });
  }
}

export interface CreateResult {
  chain: Chain;
  name: string;
  address: string;
  keystore: string;
  created: boolean;
  reason?: string;
  qr_uri?: string;
  onramp_url?: string | null;
}

export interface WalletCreateInput {
  chain?: Chain;
  mnemonic?: boolean;
  name?: string;
}

export interface WalletCreateResult {
  created: CreateResult[];
  skipped: CreateResult[];
  mnemonic?: string;
  mnemonic_stored_at?: string;
}

export async function walletCreate(input: WalletCreateInput = {}): Promise<WalletCreateResult> {
  const name = input.name ?? DEFAULT_WALLET_NAME;
  validateWalletName(name);
  if (input.mnemonic) {
    if (name !== DEFAULT_WALLET_NAME) {
      throw new CliError('invalid_input', '--mnemonic is only supported for the default wallet name.', {
        nextSteps: {
          action: 'use_default_name_or_random_key',
          suggestion: 'Drop --name, or omit --mnemonic to derive a random key for the named wallet.',
        },
      });
    }
    return walletCreateMnemonic(input.chain);
  }
  const chains = input.chain ? [input.chain] : [...SUPPORTED_CHAINS];
  const targets: Chain[] = [];
  const existing: CreateResult[] = [];

  for (const c of chains) {
    if (await keystoreExists(c, name)) {
      existing.push({
        chain: c,
        name,
        address: (await loadKeystore(c, name)).address,
        keystore: keystorePath(c, name),
        created: false,
        reason: 'keystore_already_exists',
      });
    } else {
      targets.push(c);
    }
  }

  if (input.chain && targets.length === 0) {
    throw new CliError('wallet_exists', `Keystore for ${input.chain} (${name}) already exists.`, {
      nextSteps: {
        action: 'remove_then_create',
        suggestion: `Delete ${keystorePath(input.chain, name)} to regenerate, or use a different --name.`,
      },
      extra: { chain: input.chain, name, keystore: keystorePath(input.chain, name) },
    });
  }

  if (targets.length === 0) {
    return { created: [], skipped: existing };
  }

  const passphrase = await promptNewPassphrase();
  const created: CreateResult[] = [];
  for (const c of targets) {
    const wallet = await createWallet(c, passphrase, undefined, name);
    created.push({
      chain: c,
      name,
      address: wallet.address,
      keystore: keystorePath(c, name),
      created: true,
      qr_uri: getQrUri(wallet),
      onramp_url: onrampUrl(c, wallet.address),
    });
  }
  return { created, skipped: existing };
}

async function walletCreateMnemonic(chain?: Chain): Promise<WalletCreateResult> {
  if (await mnemonicExists()) {
    throw new CliError('wallet_exists', 'A mnemonic is already stored.', {
      nextSteps: {
        action: 'remove_then_create',
        suggestion: `Delete ${mnemonicPath()} to regenerate, or use wallet show-mnemonic --danger to view.`,
      },
      extra: { keystore: mnemonicPath() },
    });
  }
  const chains = chain ? [chain] : [...SUPPORTED_CHAINS];
  for (const c of chains) {
    if (await keystoreExists(c)) {
      throw new CliError('wallet_exists', `Keystore for ${c} already exists — can't mint new mnemonic-derived key.`, {
        nextSteps: {
          action: 'remove_then_create',
          suggestion: `Delete ${keystorePath(c)} and try again.`,
        },
        extra: { chain: c, keystore: keystorePath(c) },
      });
    }
  }
  const phrase = generatePhrase();
  const passphrase = await promptNewPassphrase();
  const created: CreateResult[] = [];
  for (const c of chains) {
    const secret = deriveKey(c, phrase);
    const wallet = await createWallet(c, passphrase, secret);
    created.push({
      chain: c,
      name: DEFAULT_WALLET_NAME,
      address: wallet.address,
      keystore: keystorePath(c),
      created: true,
      qr_uri: getQrUri(wallet),
      onramp_url: onrampUrl(c, wallet.address),
    });
  }
  await saveMnemonic(phrase, passphrase, chains);
  return { created, skipped: [], mnemonic: phrase, mnemonic_stored_at: mnemonicPath() };
}

export interface WalletImportInput {
  chain: Chain;
  key: string;
  name?: string;
}

export interface WalletImportResult {
  chain: Chain;
  name: string;
  address: string;
  keystore: string;
}

export async function walletImport(input: WalletImportInput): Promise<WalletImportResult> {
  const name = input.name ?? DEFAULT_WALLET_NAME;
  validateWalletName(name);
  const bytes =
    input.chain === 'solana'
      ? Buffer.from(input.key, 'base64')
      : Buffer.from(input.key.replace(/^0x/, ''), 'hex');
  if (bytes.length !== 32) {
    const expected = input.chain === 'solana' ? '32-byte base64 private-key seed' : '32-byte hex private key';
    throw new CliError('invalid_key', `Expected ${expected}, got ${bytes.length} bytes.`, {
      nextSteps: { action: 'supply_correct_key_format' },
      extra: { chain: input.chain, got_bytes: bytes.length },
    });
  }
  if (await keystoreExists(input.chain, name)) {
    throw new CliError('wallet_exists', `Keystore for ${input.chain} (${name}) already exists.`, {
      nextSteps: {
        action: 'remove_then_import',
        suggestion: `Delete ${keystorePath(input.chain, name)} first or use a different --name.`,
      },
      extra: { chain: input.chain, name, keystore: keystorePath(input.chain, name) },
    });
  }
  const passphrase = await promptNewPassphrase();
  const wallet: Wallet = await createWallet(input.chain, passphrase, bytes, name);
  return { chain: wallet.chain, name, address: wallet.address, keystore: keystorePath(input.chain, name) };
}

export interface WalletImportMnemonicInput {
  phrase: string;
  chain?: Chain;
}

export interface WalletImportMnemonicResult {
  imported_from_mnemonic: true;
  created: CreateResult[];
  mnemonic_stored_at: string;
}

export async function walletImportMnemonic(input: WalletImportMnemonicInput): Promise<WalletImportMnemonicResult> {
  const normalized = input.phrase.trim().split(/\s+/).join(' ');
  if (!validatePhrase(normalized)) {
    throw new CliError('invalid_key', 'Invalid BIP-39 mnemonic phrase.', {
      nextSteps: { action: 'check_phrase', suggestion: 'Confirm word count (12 or 24) and spelling against the BIP-39 English wordlist.' },
    });
  }
  if (await mnemonicExists()) {
    throw new CliError('wallet_exists', 'A mnemonic is already stored.', {
      nextSteps: {
        action: 'remove_then_import',
        suggestion: `Delete ${mnemonicPath()} first, or use wallet import --key for non-mnemonic imports.`,
      },
    });
  }
  const chains = input.chain ? [input.chain] : [...SUPPORTED_CHAINS];
  for (const c of chains) {
    if (await keystoreExists(c)) {
      throw new CliError('wallet_exists', `Keystore for ${c} already exists.`, {
        nextSteps: {
          action: 'remove_then_import',
          suggestion: `Delete ${keystorePath(c)} first if you want to replace.`,
        },
        extra: { chain: c, keystore: keystorePath(c) },
      });
    }
  }
  const passphrase = await promptNewPassphrase();
  const created: CreateResult[] = [];
  for (const c of chains) {
    const secret = deriveKey(c, normalized);
    const wallet = await createWallet(c, passphrase, secret);
    created.push({
      chain: c,
      name: DEFAULT_WALLET_NAME,
      address: wallet.address,
      keystore: keystorePath(c),
      created: true,
      qr_uri: getQrUri(wallet),
      onramp_url: onrampUrl(c, wallet.address),
    });
  }
  await saveMnemonic(normalized, passphrase, chains);
  return { imported_from_mnemonic: true, created, mnemonic_stored_at: mnemonicPath() };
}

export interface WalletAddressInput {
  chain: Chain;
  name?: string;
}

export async function walletAddress(input: WalletAddressInput): Promise<{ chain: Chain; name: string; address: string }> {
  const name = input.name ?? DEFAULT_WALLET_NAME;
  validateWalletName(name);
  const file = await loadKeystore(input.chain, name);
  return { chain: file.chain, name, address: file.address };
}

export interface WalletListInput {
  chain?: Chain;
}

export async function walletList(input: WalletListInput = {}): Promise<{ wallets: Array<{ chain: Chain; names: string[] }> }> {
  const chains = input.chain ? [input.chain] : [...SUPPORTED_CHAINS];
  const rows = await Promise.all(
    chains.map(async (c) => ({ chain: c, names: await listWallets(c) })),
  );
  return { wallets: rows };
}

export interface WalletRemoveInput {
  chain: Chain;
  name?: string;
  danger?: boolean;
  skipConfirm?: boolean;
}

export interface WalletRemoveResult {
  ok: true;
  chain: Chain;
  name: string;
  address: string;
  removed_files: string[];
  unlock_cache_cleared: boolean;
}

export async function walletRemove(input: WalletRemoveInput): Promise<WalletRemoveResult> {
  if (!input.danger) {
    throw new CliError('invalid_input', 'wallet remove requires --danger flag (the keystore will be irrecoverably deleted).', {
      nextSteps: {
        action: 'pass_danger_flag',
        suggestion: 'Re-run with --danger and expect a type-to-confirm prompt (or --skip-confirm for scripting).',
      },
    });
  }
  const name = input.name ?? DEFAULT_WALLET_NAME;
  validateWalletName(name);
  if (!(await keystoreExists(input.chain, name))) {
    throw new CliError('no_wallet', `No keystore for ${input.chain} (${name}).`, {
      extra: { chain: input.chain, name },
    });
  }
  const file = await loadKeystore(input.chain, name);
  if (!input.skipConfirm) {
    await typeToConfirm(`Type EXPORT to confirm deleting ${input.chain}/${name} (${file.address})`);
  }
  const removed = await deleteKeystore(input.chain, name);
  const unlockCacheCleared = await clearUnlockCache().catch(() => false);
  return {
    ok: true,
    chain: input.chain,
    name,
    address: file.address,
    removed_files: removed,
    unlock_cache_cleared: unlockCacheCleared,
  };
}

export interface WalletExportInput {
  chain: Chain;
  name?: string;
  danger?: boolean;
  skipConfirm?: boolean;
}

export interface WalletExportResult {
  chain: Chain;
  name: string;
  address: string;
  format: 'hex' | 'base64';
  private_key: string;
}

export async function walletExport(input: WalletExportInput): Promise<WalletExportResult> {
  if (!input.danger) {
    throw new CliError(
      'invalid_input',
      'wallet export requires --danger flag to acknowledge risks.',
      {
        nextSteps: {
          action: 'pass_danger_flag',
          suggestion: 'Re-run with --danger and expect a type-to-confirm prompt (or --skip-confirm for scripting).',
        },
      },
    );
  }
  const name = input.name ?? DEFAULT_WALLET_NAME;
  validateWalletName(name);
  const file = await loadKeystore(input.chain, name);
  if (!input.skipConfirm) {
    await typeToConfirm(`Type EXPORT to confirm exporting ${input.chain}/${name} private key (${file.address})`);
  }
  const passphrase = await promptPassphrase();
  let secret: Buffer;
  try {
    secret = await decryptSecret(file.encryption, passphrase);
  } catch {
    throw new CliError('wrong_passphrase', 'Failed to decrypt keystore with the provided passphrase.', {
      nextSteps: { action: 'retry_passphrase' },
    });
  }
  const format: 'hex' | 'base64' = input.chain === 'solana' ? 'base64' : 'hex';
  const encoded = format === 'base64' ? secret.toString('base64') : '0x' + secret.toString('hex');
  return { chain: input.chain, name, address: file.address, format, private_key: encoded };
}

export interface WalletShowMnemonicInput {
  danger?: boolean;
  skipConfirm?: boolean;
}

export async function walletShowMnemonic(input: WalletShowMnemonicInput): Promise<{ mnemonic: string }> {
  if (!input.danger) {
    throw new CliError('invalid_input', 'wallet show-mnemonic requires --danger.', {
      nextSteps: {
        action: 'pass_danger_flag',
        suggestion: 'Re-run with --danger (plus --skip-confirm for scripting).',
      },
    });
  }
  if (!(await mnemonicExists())) {
    throw new CliError('no_wallet', 'No stored mnemonic. Use `wallet create --mnemonic` or `wallet import --mnemonic`.', {
      nextSteps: { action: 'create_or_import_mnemonic' },
    });
  }
  if (!input.skipConfirm) {
    await typeToConfirm('Type EXPORT to confirm printing the mnemonic');
  }
  const passphrase = await promptPassphrase();
  let phrase: string;
  try {
    phrase = await loadMnemonic(passphrase);
  } catch {
    throw new CliError('wrong_passphrase', 'Failed to decrypt mnemonic with the provided passphrase.', {
      nextSteps: { action: 'retry_passphrase' },
    });
  }
  return { mnemonic: phrase };
}

async function typeToConfirm(message: string): Promise<void> {
  const { text, isCancel, cancel } = await import('@clack/prompts');
  const answer = await text({
    message,
    validate: (v) => (v === 'EXPORT' ? undefined : 'Type EXPORT exactly to confirm'),
  });
  if (isCancel(answer)) {
    cancel('Cancelled.');
    throw new CliError('user_cancelled', 'Operation cancelled.');
  }
}
