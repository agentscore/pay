import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { ExactSvmScheme } from '@x402/svm/exact/client';
import { Mppx, tempo } from 'mppx/client';
import { USDC, type Chain } from '../constants';
import { CliError } from '../errors';
import { emitProgress, isJson, writeJson, writeText } from '../output';
import { promptPassphrase } from '../prompts';
import { selectRail } from '../selection';
import { createMppAccount, createX402Signer, loadWallet, type Wallet } from '../wallets';
import type { ClientEvmSigner } from '@x402/evm';
import type { ClientSvmSigner } from '@x402/svm';

export interface PayOptions {
  chain?: Chain;
  method: string;
  url: string;
  body?: string;
  headers?: Record<string, string>;
  maxSpendUsd?: number;
  verbose?: boolean;
}

export async function pay(opts: PayOptions): Promise<void> {
  const candidate = await selectRail({ chainOverride: opts.chain });
  if (opts.verbose) {
    emitProgress('rail_selected', {
      chain: candidate.chain,
      address: candidate.address,
      balance_usdc: candidate.balance_usdc,
      reason: opts.chain ? 'user_override' : 'auto',
    });
  }

  const passphrase = await promptPassphrase();
  const wallet = await loadWallet(candidate.chain, passphrase);

  const init: RequestInit = { method: opts.method };
  if (opts.body !== undefined) init.body = opts.body;
  init.headers = {
    'Content-Type': 'application/json',
    ...(opts.headers ?? {}),
    'X-Wallet-Address': wallet.address,
  };

  if (opts.verbose) {
    emitProgress('request', {
      method: opts.method,
      url: opts.url,
      chain: wallet.chain,
      signer: wallet.address,
      has_body: opts.body !== undefined,
    });
  }

  let res: Response;
  try {
    res = wallet.chain === 'tempo' ? await payViaMpp(wallet, opts, init) : await payViaX402(wallet, opts, init);
  } catch (err) {
    throw mapNetworkError(err);
  }

  if (opts.verbose) {
    emitProgress('response', { status: res.status, status_text: res.statusText });
  }

  const text = await res.text();
  if (isJson()) {
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    writeJson({
      ok: res.ok,
      status: res.status,
      status_text: res.statusText,
      chain: wallet.chain,
      signer: wallet.address,
      body,
    });
  } else {
    writeText(text);
    if (!text.endsWith('\n')) writeText('\n');
  }
  if (!res.ok) {
    throw new CliError('merchant_error', `Merchant returned ${res.status} ${res.statusText}`, {
      extra: { status: res.status, chain: wallet.chain },
    });
  }
}

async function payViaX402(wallet: Wallet, opts: PayOptions, init: RequestInit): Promise<Response> {
  const signer = await createX402Signer(wallet);
  const client = new x402Client();
  if (wallet.chain === 'base') {
    client.register(USDC.base.mainnet.network, new ExactEvmScheme(signer as ClientEvmSigner));
  } else if (wallet.chain === 'solana') {
    client.register(USDC.solana.mainnet.network, new ExactSvmScheme(signer as ClientSvmSigner));
  } else {
    throw new CliError('unsupported_rail', `x402 path called on chain ${wallet.chain} — use MPP for Tempo.`);
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

async function payViaMpp(wallet: Wallet, opts: PayOptions, init: RequestInit): Promise<Response> {
  const account = createMppAccount(wallet);
  const client = Mppx.create({
    methods: [tempo({ account })],
    fetch,
    onChallenge:
      opts.maxSpendUsd === undefined
        ? undefined
        : async (challenge) => {
            const max = opts.maxSpendUsd as number;
            const requests =
              (challenge as { paymentRequests?: Array<{ amount?: string; decimals?: number }> }).paymentRequests ?? [];
            for (const r of requests) {
              const decimals = Number(r.decimals ?? 6);
              const priceRaw = BigInt(r.amount ?? '0');
              const priceUsd = Number(priceRaw) / 10 ** decimals;
              if (priceUsd > max) {
                throw new CliError(
                  'max_spend_exceeded',
                  `Payment ${priceUsd} USDC exceeds --max-spend ${max}`,
                  { extra: { price_usd: priceUsd, max_spend_usd: max } },
                );
              }
            }
            return undefined;
          },
  });
  return client.fetch(opts.url, init);
}

function mapNetworkError(err: unknown): CliError {
  if (err instanceof CliError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new CliError('network_error', message, {
    nextSteps: {
      action: 'retry_or_check_merchant',
      suggestion: 'Verify the URL is reachable and the merchant accepts your rail.',
    },
  });
}
