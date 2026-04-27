import { createHash } from 'crypto';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { ExactSvmScheme } from '@x402/svm/exact/client';
import { Mppx, tempo } from 'mppx/client';
import { evmConfig, svmConfig, type Chain, type Network } from '../constants';
import { CliError } from '../errors';
import { mergeHeaders } from '../headers';
import { appendEntry } from '../ledger';
import { enforce, loadLimits } from '../limits';
import { emitProgress, isJson, writeJson, writeLine, writeText } from '../output';
import { DEFAULT_WALLET_NAME } from '../paths';
import { extractNextStepsAction, extractTxHash } from '../payment-receipt';
import { promptPassphrase } from '../prompts';
import { withRetries } from '../retry';
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
  timeoutSeconds?: number;
  retries?: number;
  walletName?: string;
}

export const DEFAULT_TIMEOUT_SECONDS = 60;
export const DEFAULT_RETRIES = 0;

interface PaymentSettled {
  price_usd?: string;
  tx_hash?: string;
}

export async function pay(opts: PayOptions): Promise<void> {
  const network: Network = opts.network ?? 'mainnet';
  const walletName = opts.walletName ?? DEFAULT_WALLET_NAME;
  const candidate = await selectRail({ chainOverride: opts.chain, walletName, network });
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
      headers: (() => {
        const userKeys = Object.keys(opts.headers ?? {}).map((k) => k.toLowerCase());
        const hasIdentity = userKeys.includes('x-operator-token') || userKeys.includes('x-wallet-address');
        return mergeHeaders(
          {
            'Content-Type': 'application/json',
            ...(hasIdentity ? {} : { 'X-Wallet-Address': candidate.address }),
          },
          opts.headers,
        );
      })(),
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
  const wallet = await loadWallet(candidate.chain, passphrase, walletName);

  const timeoutSeconds = opts.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  const init: RequestInit = { method: opts.method, signal: controller.signal };
  if (opts.body !== undefined) init.body = opts.body;
  // Auto-inject X-Wallet-Address ONLY when the caller hasn't already chosen an identity
  // header. If the agent passed X-Operator-Token, layering X-Wallet-Address on top makes
  // the merchant's gate evaluate BOTH identities — and unlinked wallets without their
  // own KYC will fail compliance even though the operator_token is fully verified.
  // Header lookup is case-insensitive per RFC 7230.
  const userHeaderKeys = Object.keys(opts.headers ?? {}).map((k) => k.toLowerCase());
  const userSpecifiedIdentity =
    userHeaderKeys.includes('x-operator-token') || userHeaderKeys.includes('x-wallet-address');
  // X-Idempotency-Key — stable across retries within this pay invocation. Merchants that
  // honor the convention (Stripe-pattern dedup) can use it to avoid double-charging when
  // a settled payment + lost network connection causes withRetries to re-fire. Hash-based
  // so the same logical payment (same url + body + method + signer) always produces the
  // same key; different invocations get different keys (timestamp salt).
  const userSpecifiedIdempotency = userHeaderKeys.includes('x-idempotency-key');
  init.headers = mergeHeaders(
    {
      'Content-Type': 'application/json',
      ...(userSpecifiedIdentity ? {} : { 'X-Wallet-Address': wallet.address }),
      ...(userSpecifiedIdempotency
        ? {}
        : { 'X-Idempotency-Key': computeIdempotencyKey({ url: opts.url, method: opts.method, body: opts.body, signer: wallet.address }) }),
    },
    opts.headers,
  );

  if (opts.verbose) {
    emitProgress('request', {
      method: opts.method,
      url: opts.url,
      chain: wallet.chain,
      signer: wallet.address,
      has_body: opts.body !== undefined,
      timeout_seconds: timeoutSeconds,
    });
  }

  const settled: PaymentSettled = {};
  const retries = opts.retries ?? DEFAULT_RETRIES;
  let res: Response;
  try {
    res = await withRetries(
      () =>
        wallet.chain === 'tempo'
          ? payViaMpp(wallet, opts, init, settled)
          : payViaX402(wallet, opts, init, network, settled),
      {
        retries,
        baseDelayMs: 200,
        onRetry: (attempt, err, delayMs) => {
          if (opts.verbose) {
            emitProgress('retry', {
              attempt,
              of: retries,
              delay_ms: delayMs,
              reason: err instanceof Error ? err.message : String(err),
            });
          }
        },
      },
    );
  } catch (err) {
    if (controller.signal.aborted) {
      throw new CliError('session_timeout', `Payment timed out after ${timeoutSeconds}s`, {
        nextSteps: {
          action: 'retry_with_higher_timeout',
          suggestion: `Re-run with --timeout ${timeoutSeconds * 2} or check if the merchant is reachable.`,
        },
        extra: { timeout_seconds: timeoutSeconds, url: opts.url },
      });
    }
    throw mapNetworkError(err);
  } finally {
    clearTimeout(timer);
  }

  if (opts.verbose) emitProgress('response', { status: res.status, status_text: res.statusText });

  const text = await res.text();
  const parsed = tryParseJson(text);

  if (!settled.tx_hash) settled.tx_hash = extractTxHash(res.headers, parsed);
  const nextStepsAction = extractNextStepsAction(parsed);

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
    ...(settled.price_usd ? { price_usd: settled.price_usd } : {}),
    ...(settled.tx_hash ? { tx_hash: settled.tx_hash } : {}),
    ...(nextStepsAction ? { next_steps_action: nextStepsAction } : {}),
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
      ...(settled.price_usd ? { price_usd: settled.price_usd } : {}),
      ...(settled.tx_hash ? { tx_hash: settled.tx_hash } : {}),
      ...(nextStepsAction ? { next_steps_action: nextStepsAction } : {}),
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

async function payViaX402(
  wallet: Wallet,
  opts: PayOptions,
  init: RequestInit,
  network: Network,
  settled: PaymentSettled,
): Promise<Response> {
  const signer = await createX402Signer(wallet, network);
  const client = new x402Client();
  // Register schemes on BOTH x402 versions. Coinbase x402-fetch and the @x402/core HTTP
  // parser hardcode `x402Version === 1` for the body shape, while the client's
  // `register()` defaults to v2. A merchant that emits `x402Version: 1` in the response
  // (forced by the parser bug) would otherwise fail with "No client registered for x402
  // version: 1" even though the scheme handler is identical between v1/v2.
  if (wallet.chain === 'base') {
    const cfg = evmConfig('base', network);
    const evmClient = new ExactEvmScheme(signer as ClientEvmSigner);
    client.register(cfg.network as `${string}:${string}`, evmClient);
    client.registerV1(cfg.network as `${string}:${string}`, evmClient);
  } else if (wallet.chain === 'solana') {
    const cfg = svmConfig(network);
    const svmClient = new ExactSvmScheme(signer as ClientSvmSigner);
    client.register(cfg.network as `${string}:${string}`, svmClient);
    client.registerV1(cfg.network as `${string}:${string}`, svmClient);
  } else {
    throw new CliError('unsupported_rail', `x402 path called on chain ${wallet.chain} — use MPP for Tempo.`);
  }

  const host = safeHost(opts.url);
  const limits = await loadLimits();
  client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
    const req = selectedRequirements as { decimals?: number; maxAmountRequired?: string; asset?: string };
    // Defensive fallback to 6 (USDC) when merchant omits decimals. Spec REQUIRES decimals
    // so the fallback is unreachable for compliant merchants — surface a warning if it
    // ever fires so non-USDC merchants emitting partial 402s don't silently mis-bill.
    if (req.decimals === undefined) {
      emitProgress('decimals_fallback', {
        message: "merchant 402 omitted 'decimals' — assuming 6 (USDC). If asset is non-USDC the price will be off by orders of magnitude.",
        asset: req.asset ?? null,
      });
    }
    const decimals = Number(req.decimals ?? 6);
    const priceRaw = BigInt(req.maxAmountRequired ?? '0');
    const priceUsd = Number(priceRaw) / 10 ** decimals;
    settled.price_usd = priceUsd.toFixed(decimals);
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

async function payViaMpp(
  wallet: Wallet,
  opts: PayOptions,
  init: RequestInit,
  settled: PaymentSettled,
): Promise<Response> {
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
        if (r.decimals === undefined) {
          emitProgress('decimals_fallback', {
            message: "merchant MPP challenge omitted 'decimals' — assuming 6 (USDC). If asset is non-USDC the price will be off by orders of magnitude.",
          });
        }
        const decimals = Number(r.decimals ?? 6);
        const priceRaw = BigInt(r.amount ?? '0');
        const priceUsd = Number(priceRaw) / 10 ** decimals;
        settled.price_usd = priceUsd.toFixed(decimals);
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

/**
 * Stable per-invocation idempotency key. Hashes the request shape (url + method + body +
 * signer) so all retries within `withRetries` reuse the same key — merchants that honor
 * X-Idempotency-Key (Stripe-pattern dedup) won't double-charge if a payment settled but
 * the network response was lost.
 *
 * Note: this is per-pay-invocation, not per-logical-purchase across pay restarts. Two
 * separate pay runs to the same URL will produce different keys (the timestamp salt
 * shifts the hash). For cross-process idempotency, callers should pass an explicit
 * X-Idempotency-Key header in `opts.headers`.
 */
function computeIdempotencyKey(input: {
  url: string;
  method: string;
  body?: string;
  signer: string;
}): string {
  const h = createHash('sha256');
  h.update(input.method);
  h.update('\0');
  h.update(input.url);
  h.update('\0');
  h.update(input.body ?? '');
  h.update('\0');
  h.update(input.signer);
  return `pay-${h.digest('hex').slice(0, 32)}`;
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
