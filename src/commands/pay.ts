import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { ExactSvmScheme } from '@x402/svm/exact/client';
import { Mppx, tempo } from 'mppx/client';
import { USDC, type Chain } from '../constants';
import { promptPassphrase } from '../prompts';
import { createMppAccount, createX402Signer, loadWallet } from '../wallets';
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

  const init: RequestInit = { method: opts.method };
  if (opts.body !== undefined) init.body = opts.body;
  init.headers = {
    'Content-Type': 'application/json',
    ...(opts.headers ?? {}),
    'X-Wallet-Address': wallet.address,
  };

  if (opts.verbose) {
    console.error(`→ ${opts.method} ${opts.url}`);
    console.error(`  chain: ${opts.chain}  signer: ${wallet.address}`);
    console.error(`  headers: ${JSON.stringify(init.headers)}`);
    if (opts.body) console.error(`  body: ${opts.body}`);
  }

  const res = opts.chain === 'tempo'
    ? await payViaMpp(wallet, opts, init)
    : await payViaX402(wallet, opts, init);

  if (opts.verbose) console.error(`← ${res.status} ${res.statusText}`);

  const text = await res.text();
  process.stdout.write(text);
  if (!text.endsWith('\n')) process.stdout.write('\n');
  if (!res.ok) process.exitCode = 1;
}

async function payViaX402(wallet: Awaited<ReturnType<typeof loadWallet>>, opts: PayOptions, init: RequestInit): Promise<Response> {
  const signer = await createX402Signer(wallet);
  const client = new x402Client();
  if (wallet.chain === 'base') {
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
  return fetchWithPay(opts.url, init);
}

async function payViaMpp(wallet: Awaited<ReturnType<typeof loadWallet>>, opts: PayOptions, init: RequestInit): Promise<Response> {
  const account = createMppAccount(wallet);
  const client = Mppx.create({
    methods: [tempo({ account })],
    fetch,
    onChallenge: opts.maxSpendUsd === undefined
      ? undefined
      : async (challenge) => {
          const max = opts.maxSpendUsd as number;
          const requests = (challenge as { paymentRequests?: Array<{ amount?: string; decimals?: number }> }).paymentRequests ?? [];
          for (const r of requests) {
            const decimals = Number(r.decimals ?? 6);
            const priceRaw = BigInt(r.amount ?? '0');
            const priceUsd = Number(priceRaw) / 10 ** decimals;
            if (priceUsd > max) {
              throw new Error(`Payment ${priceUsd} USDC exceeds --max-spend ${max}`);
            }
          }
          return undefined;
        },
  });
  return client.fetch(opts.url, init);
}
