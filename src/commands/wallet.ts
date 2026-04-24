import qrcode from 'qrcode-terminal';
import { onrampUrl, SUPPORTED_CHAINS, type Chain } from '../constants';
import { CliError } from '../errors';
import { decryptSecret, keystoreExists, loadKeystore } from '../keystore';
import { deriveKey, generatePhrase, validatePhrase } from '../mnemonic';
import { loadMnemonic, mnemonicExists, mnemonicPath, saveMnemonic } from '../mnemonic-store';
import { isHuman, isJson, writeHumanNote, writeJson, writeLine } from '../output';
import { keystorePath } from '../paths';
import { promptNewPassphrase, promptPassphrase } from '../prompts';
import { createWallet, getQrUri } from '../wallets';
import type { Wallet } from '../wallets';

interface CreateResult {
  chain: Chain;
  address: string;
  keystore: string;
  created: boolean;
  reason?: string;
  qr_uri?: string;
  onramp_url?: string | null;
}

export interface WalletCreateOptions {
  chain?: Chain;
  mnemonic?: boolean;
}

export async function walletCreate(opts: WalletCreateOptions = {}): Promise<void> {
  if (opts.mnemonic) {
    await walletCreateMnemonic(opts.chain);
    return;
  }
  const chains = opts.chain ? [opts.chain] : [...SUPPORTED_CHAINS];
  const targets: Chain[] = [];
  const existing: CreateResult[] = [];

  for (const c of chains) {
    if (await keystoreExists(c)) {
      existing.push({
        chain: c,
        address: (await loadKeystore(c)).address,
        keystore: keystorePath(c),
        created: false,
        reason: 'keystore_already_exists',
      });
    } else {
      targets.push(c);
    }
  }

  if (opts.chain && targets.length === 0) {
    throw new CliError('wallet_exists', `Keystore for ${opts.chain} already exists.`, {
      nextSteps: {
        action: 'remove_then_create',
        suggestion: `Delete ${keystorePath(opts.chain)} to regenerate, or use wallet import to restore.`,
      },
      extra: { chain: opts.chain, keystore: keystorePath(opts.chain) },
    });
  }

  if (targets.length === 0) {
    if (isJson()) {
      writeJson({ created: [], skipped: existing });
    } else {
      writeHumanNote('All requested wallets already exist:');
      for (const e of existing) writeHumanNote(`  ${e.chain.padEnd(8)} ${e.address}`);
    }
    return;
  }

  if (isHuman()) writeHumanNote(`Creating ${targets.length > 1 ? 'wallets' : `${targets[0]} wallet`}...`);
  const passphrase = await promptNewPassphrase();
  const results: CreateResult[] = [...existing];
  for (const c of targets) {
    const wallet = await createWallet(c, passphrase);
    results.push({
      chain: c,
      address: wallet.address,
      keystore: keystorePath(c),
      created: true,
      qr_uri: getQrUri(wallet),
      onramp_url: onrampUrl(c, wallet.address),
    });
  }

  emitCreateResults(results);
}

async function walletCreateMnemonic(chain?: Chain): Promise<void> {
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
  const results: CreateResult[] = [];
  for (const c of chains) {
    const secret = deriveKey(c, phrase);
    const wallet = await createWallet(c, passphrase, secret);
    results.push({
      chain: c,
      address: wallet.address,
      keystore: keystorePath(c),
      created: true,
      qr_uri: getQrUri(wallet),
      onramp_url: onrampUrl(c, wallet.address),
    });
  }
  await saveMnemonic(phrase, passphrase, chains);
  if (isJson()) {
    writeJson({
      mnemonic: phrase,
      stored_at: mnemonicPath(),
      created: results,
    });
    return;
  }
  writeHumanNote('\nBIP-39 mnemonic (write this down, DO NOT share):');
  writeHumanNote(`  ${phrase}`);
  writeHumanNote(`\nMnemonic also stored encrypted at ${mnemonicPath()} (AES-256-GCM + scrypt).`);
  writeHumanNote('');
  emitCreateResults(results);
}

export async function walletImport(chain: Chain, hexOrBase58: string): Promise<void> {
  const bytes =
    chain === 'solana'
      ? Buffer.from(hexOrBase58, 'base64')
      : Buffer.from(hexOrBase58.replace(/^0x/, ''), 'hex');
  if (bytes.length !== 32) {
    const expected = chain === 'solana' ? '32-byte base64 private-key seed' : '32-byte hex private key';
    throw new CliError('invalid_key', `Expected ${expected}, got ${bytes.length} bytes.`, {
      nextSteps: { action: 'supply_correct_key_format' },
      extra: { chain, got_bytes: bytes.length },
    });
  }
  if (await keystoreExists(chain)) {
    throw new CliError('wallet_exists', `Keystore for ${chain} already exists.`, {
      nextSteps: {
        action: 'remove_then_import',
        suggestion: `Delete ${keystorePath(chain)} first if you want to replace.`,
      },
      extra: { chain, keystore: keystorePath(chain) },
    });
  }
  const passphrase = await promptNewPassphrase();
  const wallet: Wallet = await createWallet(chain, passphrase, bytes);
  if (isJson()) {
    writeJson({ chain: wallet.chain, address: wallet.address, keystore: keystorePath(chain) });
    return;
  }
  writeHumanNote(`Imported ${chain}. Address: ${wallet.address}`);
}

export async function walletImportMnemonic(phrase: string, chain?: Chain): Promise<void> {
  const normalized = phrase.trim().split(/\s+/).join(' ');
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
  const chains = chain ? [chain] : [...SUPPORTED_CHAINS];
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
  const results: CreateResult[] = [];
  for (const c of chains) {
    const secret = deriveKey(c, normalized);
    const wallet = await createWallet(c, passphrase, secret);
    results.push({
      chain: c,
      address: wallet.address,
      keystore: keystorePath(c),
      created: true,
      qr_uri: getQrUri(wallet),
      onramp_url: onrampUrl(c, wallet.address),
    });
  }
  await saveMnemonic(normalized, passphrase, chains);
  if (isJson()) {
    writeJson({ imported_from_mnemonic: true, created: results, mnemonic_stored_at: mnemonicPath() });
    return;
  }
  writeHumanNote('Mnemonic imported and keystores derived:');
  emitCreateResults(results);
}

export async function walletAddress(chain: Chain): Promise<void> {
  const file = await loadKeystore(chain);
  if (isJson()) {
    writeJson({ chain: file.chain, address: file.address });
    return;
  }
  writeLine(file.address);
}

export interface WalletExportOptions {
  chain: Chain;
  danger?: boolean;
  skipConfirm?: boolean;
}

export async function walletExport(opts: WalletExportOptions): Promise<void> {
  if (!opts.danger) {
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
  const file = await loadKeystore(opts.chain);
  if (!opts.skipConfirm) {
    await typeToConfirm(`Type EXPORT to confirm exporting ${opts.chain} private key (${file.address})`);
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
  const format = opts.chain === 'solana' ? 'base64' : 'hex';
  const encoded = format === 'base64' ? secret.toString('base64') : '0x' + secret.toString('hex');
  if (isJson()) {
    writeJson({ chain: opts.chain, address: file.address, format, private_key: encoded });
    return;
  }
  writeLine(`# Chain:   ${opts.chain}`);
  writeLine(`# Address: ${file.address}`);
  writeLine(`# Format:  ${format}`);
  writeLine(encoded);
}

export interface WalletShowMnemonicOptions {
  danger?: boolean;
  skipConfirm?: boolean;
}

export async function walletShowMnemonic(opts: WalletShowMnemonicOptions): Promise<void> {
  if (!opts.danger) {
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
  if (!opts.skipConfirm) {
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
  if (isJson()) {
    writeJson({ mnemonic: phrase });
    return;
  }
  writeLine(phrase);
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

function emitCreateResults(results: CreateResult[]): void {
  if (isJson()) {
    writeJson({
      created: results.filter((r) => r.created),
      skipped: results.filter((r) => !r.created),
    });
    return;
  }
  for (const r of results) {
    if (!r.created) {
      writeHumanNote(`- ${r.chain.padEnd(8)} already exists (${r.address})`);
      continue;
    }
    writeHumanNote(`\n✓ ${r.chain.toUpperCase()}`);
    writeHumanNote(`  Address:  ${r.address}`);
    writeHumanNote(`  Keystore: ${r.keystore}`);
    if (r.onramp_url) {
      writeHumanNote('  Fund via Coinbase Onramp:');
      writeHumanNote(`    ${r.onramp_url}`);
    } else if (r.chain === 'tempo') {
      writeHumanNote('  Fund via Tempo: `tempo wallet fund` or transfer USDC.e (chain 4217)');
    }
    if (r.qr_uri) qrcode.generate(r.qr_uri, { small: true });
  }
  writeHumanNote('\nNext: `agentscore-pay fund --chain <c>` to add USDC, or `agentscore-pay pay ...` to spend.');
}
