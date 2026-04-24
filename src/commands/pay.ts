import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { ExactSvmScheme } from '@x402/svm/exact/client';
import { Mppx, tempo } from 'mppx/client';
import { evmConfig, svmConfig, type Chain, type Network } from '../constants';
import { CliError } from '../errors';
import { appendEntry } from '../ledger';
import { enforce, loadLimits } from '../limits';
import { emitProgress, isJson, writeJson, writeLine, writeText } from '../output';
import { promptPassphrase } from '../prompts';
import { selectRail } from '../selection';
import { createMppAccount, createX402Signer, loadWallet, type Wallet } from '../wallets';
import type { ClientEvmSigner } from '@x402/evm';
import type { ClientSvmSigner } from '@x402/svm';

export interface PayOptions {
  chain?: Chain;
  network?: Network;
  method: string;
  url: string;
  body?: string;
  headers?: Record<string, string>;
  maxSpendUsd?: number;
  verbose?: boolean;
  dryRun?: boolean;
}

export async function pay(opts: PayOptions): Promise<void> {
  const network: Network = opts.network ?? 'mainnet';
  const candidate = await selectRail({ chainOverride: opts.chain, network });
  if (opts.verbose) {
    emitProgress('rail_selected', {
      chain: candidate.chain,
      address: candidate.address,
      balance_usdc: candidate.balance_usdc,
      reason: opts.chain ? 'user_override' : 'auto',
    });
  }

  if (opts.dryRun) {
    const dryPayload = {
      dry_run: true,
      selected_chain: candidate.chain,
      signer: candidate.address,
      balance_usdc: candidate.balance_usdc,
      method: opts.method,
      url: opts.url,
      protocol: candidate.chain === 'tempo' ? 'mpp' : 'x402',
      headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}), 'X-Wallet-Address': candidate.address },
      body: opts.body ?? null,
      max_spend_usd: opts.maxSpendUsd ?? null,
    };
    if (isJson()) {
      writeJson(dryPayload);
    } else {
      writeLine('[dry-run] would sign and send:');
      writeLine(`  ${opts.method} ${opts.url}`);
      writeLine(`  chain=${candidate.chain} signer=${candidate.address} balance=$${candidate.balance_usdc}`);
      writeLine(`  protocol=${dryPayload.protocol}`);
      if (opts.maxSpendUsd !== undefined) writeLine(`  max-spend=$${opts.maxSpendUsd}`);
      if (opts.body) writeLine(`  body=${opts.body}`);
    }
    return;
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
    res = wallet.chain === 'tempo'
      ? await payViaMpp(wallet, opts, init)
      : await payViaX402(wallet, opts, init, network);
  } catch (err) {
    throw mapNetworkError(err);
  }

  if (opts.verbose) emitProgress('response', { status: res.status, status_text: res.statusText });

  const text = await res.text();
  const parsed = tryParseJson(text);

  const host = safeHost(opts.url);
  const entry = {
    timestamp: new Date().toISOString(),
    chain: wallet.chain,
    signer: wallet.address,
    method: opts.method,
    url: opts.url,
    host,
    status: res.status,
    protocol: (wallet.chain === 'tempo' ? 'mpp' : 'x402') as 'mpp' | 'x402',
    ok: res.ok,
  };
  await appendEntry(entry);

  if (isJson()) {
    writeJson({
      ok: res.ok,
      status: res.status,
      status_text: res.statusText,
      chain: wallet.chain,
      signer: wallet.address,
      body: parsed ?? text,
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

function tryParseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function payViaX402(wallet: Wallet, opts: PayOptions, init: RequestInit, network: Network): Promise<Response> {
  const signer = await createX402Signer(wallet, network);
  const client = new x402Client();
  if (wallet.chain === 'base') {
    const cfg = evmConfig('base', network);
    client.register(cfg.network as `${string}:${string}`, new ExactEvmScheme(signer as ClientEvmSigner));
  } else if (wallet.chain === 'solana') {
    const cfg = svmConfig(network);
    client.register(cfg.network as `${string}:${string}`, new ExactSvmScheme(signer as ClientSvmSigner));
  } else {
    throw new CliError('unsupported_rail', `x402 path called on chain ${wallet.chain} — use MPP for Tempo.`);
  }

  const host = safeHost(opts.url);
  const limits = await loadLimits();
  client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
    const req = selectedRequirements as { decimals?: number; maxAmountRequired?: string };
    const decimals = Number(req.decimals ?? 6);
    const priceRaw = BigInt(req.maxAmountRequired ?? '0');
    const priceUsd = Number(priceRaw) / 10 ** decimals;
    if (opts.maxSpendUsd !== undefined && priceUsd > opts.maxSpendUsd) {
      return { abort: true, reason: `Payment ${priceUsd} USDC exceeds --max-spend ${opts.maxSpendUsd}` };
    }
    const verdict = await enforce(limits, { priceUsd, host });
    if (!verdict.allowed) {
      return { abort: true, reason: `Local limit violated (${verdict.violated}=${verdict.limit}, would be ${verdict.would_be}).` };
    }
  });

  const fetchWithPay = wrapFetchWithPayment(fetch, client);
  return fetchWithPay(opts.url, init);
}

async function payViaMpp(wallet: Wallet, opts: PayOptions, init: RequestInit): Promise<Response> {
  const account = createMppAccount(wallet);
  const host = safeHost(opts.url);
  const limits = await loadLimits();
  const client = Mppx.create({
    methods: [tempo({ account })],
    fetch,
    onChallenge: async (challenge) => {
      const requests =
        (challenge as { paymentRequests?: Array<{ amount?: string; decimals?: number }> }).paymentRequests ?? [];
      for (const r of requests) {
        const decimals = Number(r.decimals ?? 6);
        const priceRaw = BigInt(r.amount ?? '0');
        const priceUsd = Number(priceRaw) / 10 ** decimals;
        if (opts.maxSpendUsd !== undefined && priceUsd > opts.maxSpendUsd) {
          throw new CliError(
            'max_spend_exceeded',
            `Payment ${priceUsd} USDC exceeds --max-spend ${opts.maxSpendUsd}`,
            { extra: { price_usd: priceUsd, max_spend_usd: opts.maxSpendUsd } },
          );
        }
        const verdict = await enforce(limits, { priceUsd, host });
        if (!verdict.allowed) {
          throw new CliError('limit_exceeded', `Local limit violated: ${verdict.violated}=${verdict.limit}`, {
            extra: { violated: verdict.violated, limit: verdict.limit, would_be: verdict.would_be },
          });
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
