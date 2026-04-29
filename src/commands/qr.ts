import qrcode from 'qrcode-terminal';
import * as baseChain from '../chains/base';
import * as solanaChain from '../chains/solana';
import * as tempoChain from '../chains/tempo';
import { loadKeystore } from '../keystore';
import { DEFAULT_WALLET_NAME } from '../paths';
import type { Chain, Network } from '../constants';

export interface QrInput {
  chain: Chain;
  amountUsd?: number;
  network?: Network;
  name?: string;
}

export interface QrResult {
  chain: Chain;
  address: string;
  token: 'USDC';
  amount_usd: number | null;
  uri: string;
  ascii_qr: string;
}

export async function qr(input: QrInput): Promise<QrResult> {
  const network = input.network ?? 'mainnet';
  const name = input.name ?? DEFAULT_WALLET_NAME;
  const ks = await loadKeystore(input.chain, name);
  const uri =
    input.chain === 'base'
      ? baseChain.qrUri(ks.address, input.amountUsd, network)
      : input.chain === 'solana'
        ? solanaChain.qrUri(ks.address, input.amountUsd, network)
        : tempoChain.qrUri(ks.address, input.amountUsd, network);

  // Capture QR ascii into a string instead of printing to stdout — caller decides
  // whether to render it (TTY) or pass it through structured output (JSON/TOON).
  const ascii_qr = await new Promise<string>((resolve) => {
    qrcode.generate(uri, { small: true }, (q) => resolve(q));
  });

  return {
    chain: input.chain,
    address: ks.address,
    token: 'USDC',
    amount_usd: input.amountUsd ?? null,
    uri,
    ascii_qr,
  };
}
