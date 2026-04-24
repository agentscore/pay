import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { ExactSvmScheme } from '@x402/svm/exact/client';
import { USDC, type Chain } from '../constants';
import { promptPassphrase } from '../prompts';
import { createX402Signer, loadWallet } from '../wallets';
import type { ClientEvmSigner } from '@x402/evm';
import type { ClientSvmSigner } from '@x402/svm';

export interface PayOptions {
  chain: Chain;
  method: string;
  url: string;
  body?: string;
  headers?: Record<string, string>;
  maxSpendUsd?: number;
  verbose?: boolean;
}

export async function pay(opts: PayOptions): Promise<void> {
  const passphrase = await promptPassphrase();
  const wallet = await loadWallet(opts.chain, passphrase);
  const signer = await createX402Signer(wallet);

  const client = new x402Client();
  if (opts.chain === 'base') {
    client.register(USDC.base.mainnet.network, new ExactEvmScheme(signer as ClientEvmSigner));
  } else {
    client.register(USDC.solana.mainnet.network, new ExactSvmScheme(signer as ClientSvmSigner));
  }

  if (opts.maxSpendUsd !== undefined) {
    const max = opts.maxSpendUsd;
    client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
      const req = selectedRequirements as { decimals?: number; maxAmountRequired?: string };
      const decimals = Number(req.decimals ?? 6);
      const priceRaw = BigInt(req.maxAmountRequired ?? '0');
      const priceUsd = Number(priceRaw) / 10 ** decimals;
      if (priceUsd > max) {
        return { abort: true, reason: `Payment ${priceUsd} USDC exceeds --max-spend ${max}` };
      }
    });
  }

  const fetchWithPay = wrapFetchWithPayment(fetch, client);
  const init: RequestInit = { method: opts.method };
  if (opts.body !== undefined) init.body = opts.body;
  init.headers = {
    'Content-Type': 'application/json',
    ...(opts.headers ?? {}),
    'X-Wallet-Address': wallet.address,
  };

  if (opts.verbose) {
    console.error(`→ ${opts.method} ${opts.url}`);
    console.error(`  headers: ${JSON.stringify(init.headers)}`);
    if (opts.body) console.error(`  body: ${opts.body}`);
  }

  const res = await fetchWithPay(opts.url, init);

  if (opts.verbose) {
    console.error(`← ${res.status} ${res.statusText}`);
  }

  const text = await res.text();
  process.stdout.write(text);
  if (!text.endsWith('\n')) process.stdout.write('\n');
  if (!res.ok) process.exitCode = 1;
}
