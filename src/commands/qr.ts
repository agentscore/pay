import qrcode from 'qrcode-terminal';
import * as baseChain from '../chains/base';
import * as solanaChain from '../chains/solana';
import * as tempoChain from '../chains/tempo';
import { loadKeystore } from '../keystore';
import type { Chain } from '../constants';

export async function qr(chain: Chain, amountUsd?: number): Promise<void> {
  const ks = await loadKeystore(chain);
  const uri =
    chain === 'base'
      ? baseChain.qrUri(ks.address, amountUsd)
      : chain === 'solana'
        ? solanaChain.qrUri(ks.address, amountUsd)
        : tempoChain.qrUri(ks.address, amountUsd);
  qrcode.generate(uri, { small: true });
  console.log('');
  console.log(`Address:  ${ks.address}`);
  console.log(`Chain:    ${chain}`);
  console.log('Token:    USDC');
  if (amountUsd && amountUsd > 0) console.log(`Amount:   ${amountUsd} USDC`);
  console.log('');
  console.log(uri.length > 80 ? `URI:      ${uri.slice(0, 77)}...` : `URI:      ${uri}`);
}
