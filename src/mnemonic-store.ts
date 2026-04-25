import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { CliError } from './errors';
import { decryptSecret, encryptSecret } from './keystore';
import { mnemonicPath } from './paths';

export { mnemonicPath } from './paths';

export interface MnemonicFile {
  version: 1;
  created_at: string;
  chains: string[];
  encryption: {
    kdf: 'scrypt';
    kdfParams: { N: number; r: number; p: number; saltHex: string };
    cipher: 'aes-256-gcm';
    cipherIv: string;
    cipherAuthTag: string;
    ciphertext: string;
  };
}

export async function saveMnemonic(phrase: string, passphrase: string, chains: string[]): Promise<void> {
  const path = mnemonicPath();
  const encryption = await encryptSecret(Buffer.from(phrase, 'utf-8'), passphrase);
  const file: MnemonicFile = {
    version: 1,
    created_at: new Date().toISOString(),
    chains: [...chains],
    encryption,
  };
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(file, null, 2), { mode: 0o600 });
}

export async function loadMnemonic(passphrase: string): Promise<string> {
  const raw = await readFile(mnemonicPath(), 'utf-8');
  const file = JSON.parse(raw) as MnemonicFile;
  let secret: Buffer;
  try {
    secret = await decryptSecret(file.encryption, passphrase);
  } catch {
    throw new CliError('wrong_passphrase', 'Failed to decrypt the stored mnemonic with the provided passphrase.', {
      nextSteps: { action: 'retry_passphrase' },
    });
  }
  return secret.toString('utf-8');
}

export async function mnemonicExists(): Promise<boolean> {
  try {
    await readFile(mnemonicPath(), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

export async function clearMnemonic(): Promise<void> {
  try {
    await rm(mnemonicPath());
  } catch (err) {
    if (!err || typeof err !== 'object' || !('code' in err) || (err as { code: string }).code !== 'ENOENT') {
      throw err;
    }
  }
}
