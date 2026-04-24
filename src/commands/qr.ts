import qrcode from 'qrcode-terminal';
import * as baseChain from '../chains/base';
import * as solanaChain from '../chains/solana';
import * as tempoChain from '../chains/tempo';
import { loadKeystore } from '../keystore';
import { isJson, writeJson, writeLine } from '../output';
import type { Chain } from '../constants';

export async function qr(chain: Chain, amountUsd?: number): Promise<void> {
  const ks = await loadKeystore(chain);
  const uri =
    chain === 'base'
      ? baseChain.qrUri(ks.address, amountUsd)
      : chain === 'solana'
        ? solanaChain.qrUri(ks.address, amountUsd)
        : tempoChain.qrUri(ks.address, amountUsd);

  if (isJson()) {
    writeJson({
      chain,
      address: ks.address,
      token: 'USDC',
      amount_usd: amountUsd ?? null,
      uri,
    });
    return;
  }
  qrcode.generate(uri, { small: true });
  writeLine('');
  writeLine(`Address:  ${ks.address}`);
  writeLine(`Chain:    ${chain}`);
  writeLine('Token:    USDC');
  if (amountUsd && amountUsd > 0) writeLine(`Amount:   ${amountUsd} USDC`);
  writeLine('');
  writeLine(uri.length > 80 ? `URI:      ${uri.slice(0, 77)}...` : `URI:      ${uri}`);
}
