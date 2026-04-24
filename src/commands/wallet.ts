import { intro, note, outro } from '@clack/prompts';
import qrcode from 'qrcode-terminal';
import { onrampUrl, type Chain } from '../constants';
import { keystorePath } from '../keystore';
import { promptNewPassphrase } from '../prompts';
import { createWallet, getQrUri } from '../wallets';

export async function walletCreate(chain: Chain): Promise<void> {
  intro(`Create ${chain} wallet`);
  const passphrase = await promptNewPassphrase();
  const wallet = await createWallet(chain, passphrase);
  const path = keystorePath(chain);
  note(
    [
      `Address:  ${wallet.address}`,
      `Keystore: ${path}`,
      '',
      'Fund this address with USDC:',
      `  • Coinbase Onramp: ${onrampUrl(chain, wallet.address)}`,
      `  • From another wallet: send USDC on ${chain} to ${wallet.address}`,
    ].join('\n'),
    'Wallet created',
  );
  const uri = await getQrUri(wallet);
  qrcode.generate(uri, { small: true });
  outro('Done. Next: fund, then pay.');
}

export async function walletImport(chain: Chain, hexOrBase58: string): Promise<void> {
  intro(`Import ${chain} wallet`);
  const bytes =
    chain === 'base'
      ? Buffer.from(hexOrBase58.replace(/^0x/, ''), 'hex')
      : Buffer.from(hexOrBase58, 'base64');
  if (bytes.length !== 32) {
    const expected = chain === 'base' ? '32-byte hex private key' : '32-byte base64 private key seed';
    throw new Error(`Expected ${expected}, got ${bytes.length} bytes`);
  }
  const passphrase = await promptNewPassphrase();
  const wallet = await createWallet(chain, passphrase, bytes);
  outro(`Imported. Address: ${wallet.address}`);
}

export async function walletAddress(chain: Chain): Promise<void> {
  const { loadKeystore } = await import('../keystore');
  const file = await loadKeystore(chain);
  console.log(file.address);
}
