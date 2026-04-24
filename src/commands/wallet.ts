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
