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
  const onramp = onrampUrl(chain, wallet.address);
  const fundingLines = onramp
    ? [`  • Coinbase Onramp: ${onramp}`, `  • From another wallet: send USDC on ${chain} to ${wallet.address}`]
    : [
        '  • Coinbase Onramp does not support Tempo.',
        '  • Use `tempo wallet fund` or transfer USDC.e (chain 4217) from an existing Tempo wallet.',
      ];
  note(
    [
      `Address:  ${wallet.address}`,
      `Keystore: ${path}`,
      '',
      'Fund this address with USDC:',
      ...fundingLines,
    ].join('\n'),
    'Wallet created',
  );
  const uri = getQrUri(wallet);
  qrcode.generate(uri, { small: true });
  outro('Done. Next: fund, then pay.');
}

export async function walletImport(chain: Chain, hexOrBase58: string): Promise<void> {
  intro(`Import ${chain} wallet`);
  const bytes =
    chain === 'solana'
      ? Buffer.from(hexOrBase58, 'base64')
      : Buffer.from(hexOrBase58.replace(/^0x/, ''), 'hex');
  if (bytes.length !== 32) {
    const expected = chain === 'solana' ? '32-byte base64 private key seed' : '32-byte hex private key';
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
