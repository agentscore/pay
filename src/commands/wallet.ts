import qrcode from 'qrcode-terminal';
import { onrampUrl, SUPPORTED_CHAINS, type Chain } from '../constants';
import { CliError } from '../errors';
import { keystoreExists, keystorePath, loadKeystore } from '../keystore';
import { isHuman, isJson, writeHumanNote, writeJson, writeLine } from '../output';
import { promptNewPassphrase } from '../prompts';
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

export async function walletCreate(chain?: Chain): Promise<void> {
  const chains = chain ? [chain] : [...SUPPORTED_CHAINS];
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

  if (chain && targets.length === 0) {
    throw new CliError('wallet_exists', `Keystore for ${chain} already exists.`, {
      nextSteps: {
        action: 'remove_then_create',
        suggestion: `Delete ${keystorePath(chain)} to regenerate, or use wallet import to restore.`,
      },
      extra: { chain, keystore: keystorePath(chain) },
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
  const { decryptSecret } = await import('../keystore');
  const { loadKeystore: load } = await import('../keystore');
  const file = await load(opts.chain);

  if (!opts.skipConfirm) {
    const { text, isCancel, cancel } = await import('@clack/prompts');
    const answer = await text({
      message: `Type EXPORT to confirm exporting ${opts.chain} private key (${file.address})`,
      validate: (v) => (v === 'EXPORT' ? undefined : 'Type EXPORT exactly to confirm'),
    });
    if (isCancel(answer)) {
      cancel('Cancelled.');
      throw new CliError('user_cancelled', 'Export cancelled.');
    }
  }

  const { promptPassphrase } = await import('../prompts');
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
