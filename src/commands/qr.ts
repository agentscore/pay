import qrcode from 'qrcode-terminal';
import * as baseChain from '../chains/base';
import * as solanaChain from '../chains/solana';
import * as tempoChain from '../chains/tempo';
import { loadKeystore } from '../keystore';
import { isJson, writeJson, writeLine } from '../output';
import { DEFAULT_WALLET_NAME } from '../paths';
import type { Chain, Network } from '../constants';

export async function qr(chain: Chain, amountUsd?: number, network: Network = 'mainnet', name: string = DEFAULT_WALLET_NAME): Promise<void> {
  const ks = await loadKeystore(chain, name);
  const uri =
    chain === 'base'
      ? baseChain.qrUri(ks.address, amountUsd, network)
      : chain === 'solana'
        ? solanaChain.qrUri(ks.address, amountUsd, network)
        : tempoChain.qrUri(ks.address, amountUsd, network);

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
