import { createHash } from 'crypto';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { ExactSvmScheme } from '@x402/svm/exact/client';
import { Mppx, tempo } from 'mppx/client';
import { evmConfig, isKnownUSDC, svmConfig, type Chain, type Network } from '../constants';
import { CliError } from '../errors';
import { mergeHeaders } from '../headers';
import { appendEntry } from '../ledger';
import { enforce, loadLimits } from '../limits';
import { attachPassport } from '../passport/attach';
import { DEFAULT_WALLET_NAME } from '../paths';
import { extractNextStepsAction, extractTxHash } from '../payment-receipt';
import { emitProgress } from '../progress';
import { promptPassphrase } from '../prompts';
import { withRetries } from '../retry';
import { selectRail } from '../selection';
import { createMppAccount, createX402Signer, loadWallet, type Wallet } from '../wallets';
import type { ClientEvmSigner } from '@x402/evm';
import type { ClientSvmSigner } from '@x402/svm';

export interface PayInput {
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
  name?: string;
  /** When true, do not auto-attach the stored AgentScore Passport. Default false. */
  noPassport?: boolean;
}

export type Protocol = 'x402' | 'mpp';

export interface PayDryRunResult {
  dry_run: true;
  selected_chain: Chain;
  signer: string;
  balance_usdc: string;
  method: string;
  url: string;
  protocol: Protocol;
  headers: Record<string, string>;
  body: string | null;
  max_spend_usd: number | null;
}

export interface PaySettledResult {
  dry_run?: false;
  ok: boolean;
  status: number;
  status_text: string;
  chain: Chain;
  signer: string;
  protocol: Protocol;
  price_usd?: string;
  tx_hash?: string;
  next_steps_action?: string;
  body: unknown;
}

export type PayResult = PayDryRunResult | PaySettledResult;

export const DEFAULT_TIMEOUT_SECONDS = 60;
export const DEFAULT_RETRIES = 0;

interface PaymentSettled {
  price_usd?: string;
  tx_hash?: string;
  /**
   * Structured abort surfaced by the x402 onBeforePaymentCreation hook. x402-fetch wraps
   * any error thrown from the hook in a generic Error("Failed to create payment payload: ..."),
   * stripping CliError fields. Stashing it here lets the outer catch re-raise the original
   * with the right code + nextSteps.
   */
  cliError?: CliError;
}

export async function pay(input: PayInput): Promise<PayResult> {
  const network: Network = input.network ?? 'mainnet';
  const walletName = input.name ?? DEFAULT_WALLET_NAME;
  const candidate = await selectRail({ chainOverride: input.chain, walletName, network });
  if (input.verbose) {
    emitProgress('rail_selected', {
      chain: candidate.chain,
      address: candidate.address,
      balance_usdc: candidate.balance_usdc,
      reason: input.chain ? 'user_override' : 'auto',
    });
  }

  const protocol: Protocol = candidate.chain === 'tempo' ? 'mpp' : 'x402';

  // Resolve AgentScore Passport once (also reused on the live path below). When the
  // caller provided their own X-Operator-Token or set --no-passport, this is a no-op.
  const userHeaderKeysAll = Object.keys(input.headers ?? {}).map((k) => k.toLowerCase());
  const callerOperatorToken = userHeaderKeysAll.includes('x-operator-token')
    ? Object.entries(input.headers ?? {}).find(([k]) => k.toLowerCase() === 'x-operator-token')?.[1]
    : undefined;
  const passportAttach = await attachPassport({
    noPassport: input.noPassport,
    callerSuppliedOperatorToken: callerOperatorToken,
  });

  if (input.dryRun) {
    const userKeys = userHeaderKeysAll;
    const callerHasIdentity = userKeys.includes('x-operator-token') || userKeys.includes('x-wallet-address');
    const passportInjects = passportAttach.kind === 'attached';
    const hasIdentity = callerHasIdentity || passportInjects;
    const headers = mergeHeaders(
      {
        'Content-Type': 'application/json',
        ...(passportInjects && passportAttach.operatorToken
          ? { 'X-Operator-Token': passportAttach.operatorToken }
          : {}),
        ...(hasIdentity ? {} : { 'X-Wallet-Address': candidate.address }),
      },
      input.headers,
    );
    return {
      dry_run: true,
      selected_chain: candidate.chain,
      signer: candidate.address,
      balance_usdc: candidate.balance_usdc,
      method: input.method,
      url: input.url,
      protocol,
      headers,
      body: input.body ?? null,
      max_spend_usd: input.maxSpendUsd ?? null,
    };
  }

  const passphrase = await promptPassphrase();
  const wallet = await loadWallet(candidate.chain, passphrase, walletName);

  const timeoutSeconds = input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  const init: RequestInit = { method: input.method, signal: controller.signal };
  if (input.body !== undefined) init.body = input.body;
  // Auto-inject X-Wallet-Address ONLY when the caller hasn't already chosen an identity
  // header. If the agent passed X-Operator-Token, layering X-Wallet-Address on top makes
  // the merchant's gate evaluate BOTH identities — and unlinked wallets without their
  // own KYC will fail compliance even though the operator_token is fully verified.
  const userHeaderKeys = userHeaderKeysAll;
  const userSpecifiedIdentity =
    userHeaderKeys.includes('x-operator-token') || userHeaderKeys.includes('x-wallet-address');
  const passportInjectsIdentity = passportAttach.kind === 'attached';
  const userSpecifiedIdempotency = userHeaderKeys.includes('x-idempotency-key');
  init.headers = mergeHeaders(
    {
      'Content-Type': 'application/json',
      ...(passportInjectsIdentity && passportAttach.operatorToken
        ? { 'X-Operator-Token': passportAttach.operatorToken }
        : {}),
      ...(userSpecifiedIdentity || passportInjectsIdentity ? {} : { 'X-Wallet-Address': wallet.address }),
      ...(userSpecifiedIdempotency
        ? {}
        : { 'X-Idempotency-Key': computeIdempotencyKey({ url: input.url, method: input.method, body: input.body, signer: wallet.address }) }),
    },
    input.headers,
  );

  if (input.verbose && passportInjectsIdentity) {
    emitProgress('passport_attached', {
      operator_token_prefix: passportAttach.operatorToken!.slice(0, 8) + '…',
      expires_in_days: passportAttach.passport
        ? Math.max(0, Math.floor((passportAttach.passport.expires_at - Date.now()) / (24 * 60 * 60 * 1000)))
        : null,
      expiring_soon: passportAttach.expiringSoon ?? false,
    });
  }
  if (passportAttach.expiringSoon) {
    process.stderr.write(`Passport expires soon — run \`pay passport login\` to renew before ${new Date(passportAttach.passport!.expires_at).toISOString()}.\n`);
  }
  if (passportAttach.kind === 'expired') {
    process.stderr.write('Stored Passport has expired. Run `pay passport login` to renew.\n');
  }

  if (input.verbose) {
    emitProgress('request', {
      method: input.method,
      url: input.url,
      chain: wallet.chain,
      signer: wallet.address,
      has_body: input.body !== undefined,
      timeout_seconds: timeoutSeconds,
    });
  }

  const settled: PaymentSettled = {};
  const retries = input.retries ?? DEFAULT_RETRIES;
  let res: Response;
  try {
    res = await withRetries(
      () =>
        wallet.chain === 'tempo'
          ? payViaMpp(wallet, input, init, settled)
          : payViaX402(wallet, input, init, network, settled),
      {
        retries,
        baseDelayMs: 200,
        onRetry: (attempt, err, delayMs) => {
          if (input.verbose) {
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
  } catch (err: unknown) {
    if (settled.cliError) throw settled.cliError;
    if (controller.signal.aborted) {
      throw new CliError('session_timeout', `Payment timed out after ${timeoutSeconds}s`, {
        nextSteps: {
          action: 'retry_with_higher_timeout',
          suggestion: `Re-run with --timeout ${timeoutSeconds * 2} or check if the merchant is reachable.`,
        },
        extra: { timeout_seconds: timeoutSeconds, url: input.url },
      });
    }
    throw mapNetworkError(err);
  } finally {
    clearTimeout(timer);
  }

  if (input.verbose) emitProgress('response', { status: res.status, status_text: res.statusText });

  const text = await res.text();
  const parsed = tryParseJson(text);

  if (!settled.tx_hash) settled.tx_hash = extractTxHash(res.headers, parsed);
  const nextStepsAction = extractNextStepsAction(parsed);

  const host = safeHost(input.url);
  const entry = {
    timestamp: new Date().toISOString(),
    chain: wallet.chain,
    signer: wallet.address,
    method: input.method,
    url: input.url,
    host,
    status: res.status,
    protocol,
    ...(settled.price_usd ? { price_usd: settled.price_usd } : {}),
    ...(settled.tx_hash ? { tx_hash: settled.tx_hash } : {}),
    ...(nextStepsAction ? { next_steps_action: nextStepsAction } : {}),
    ok: res.ok,
  };
  await appendEntry(entry);

  const result: PaySettledResult = {
    ok: res.ok,
    status: res.status,
    status_text: res.statusText,
    chain: wallet.chain,
    signer: wallet.address,
    protocol,
    ...(settled.price_usd ? { price_usd: settled.price_usd } : {}),
    ...(settled.tx_hash ? { tx_hash: settled.tx_hash } : {}),
    ...(nextStepsAction ? { next_steps_action: nextStepsAction } : {}),
    body: parsed ?? text,
  };
  if (!res.ok) {
    throw new CliError('merchant_error', `Merchant returned ${res.status} ${res.statusText}`, {
      extra: { status: res.status, chain: wallet.chain, body: result.body },
    });
  }
  return result;
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

function resolveDecimals(declared: number | undefined, asset: string | undefined, chain: Chain): number {
  if (declared !== undefined) return Number(declared);
  if (isKnownUSDC(asset, chain)) return 6;
  throw new CliError(
    'merchant_spec_violation',
    `Merchant 402 omitted 'decimals' for unrecognized asset ${asset ?? '(none)'} on ${chain}. Refusing to pay — guessing decimals risks orders-of-magnitude mis-billing.`,
    {
      nextSteps: {
        action: 'contact_merchant',
        suggestion: 'Ask the merchant to include the required `decimals` field in their 402 challenge per the paymentauth.org / x402 spec.',
      },
      extra: { chain, asset: asset ?? null },
    },
  );
}

async function payViaX402(
  wallet: Wallet,
  input: PayInput,
  init: RequestInit,
  network: Network,
  settled: PaymentSettled,
): Promise<Response> {
  const signer = await createX402Signer(wallet, network);
  const client = new x402Client();
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

  const host = safeHost(input.url);
  const limits = await loadLimits();
  client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
    const req = selectedRequirements as {
      amount?: string;
      maxAmountRequired?: string;
      asset?: string;
      extra?: { decimals?: number };
    };
    try {
      const declaredDecimals = typeof req.extra?.decimals === 'number' ? req.extra.decimals : undefined;
      const decimals = resolveDecimals(declaredDecimals, req.asset, wallet.chain);
      const priceRaw = BigInt(req.amount ?? req.maxAmountRequired ?? '0');
      const priceUsd = Number(priceRaw) / 10 ** decimals;
      settled.price_usd = priceUsd.toFixed(decimals);
      if (input.maxSpendUsd !== undefined && priceUsd > input.maxSpendUsd) {
        settled.cliError = new CliError(
          'max_spend_exceeded',
          `Payment ${priceUsd} USDC exceeds --max-spend ${input.maxSpendUsd}`,
          { extra: { price_usd: priceUsd, max_spend_usd: input.maxSpendUsd } },
        );
        return { abort: true, reason: settled.cliError.message };
      }
      const verdict = await enforce(limits, { priceUsd, host });
      if (!verdict.allowed) {
        settled.cliError = new CliError(
          'limit_exceeded',
          `Local limit violated: ${verdict.violated}=${verdict.limit}`,
          { extra: { violated: verdict.violated, limit: verdict.limit, would_be: verdict.would_be } },
        );
        return { abort: true, reason: settled.cliError.message };
      }
    } catch (err: unknown) {
      if (err instanceof CliError) {
        settled.cliError = err;
        return { abort: true, reason: err.message };
      }
      throw err;
    }
  });

  const fetchWithPay = wrapFetchWithPayment(fetch, client);
  return fetchWithPay(input.url, init);
}

async function payViaMpp(
  wallet: Wallet,
  input: PayInput,
  init: RequestInit,
  settled: PaymentSettled,
): Promise<Response> {
  const account = createMppAccount(wallet);
  const host = safeHost(input.url);
  const limits = await loadLimits();
  const client = Mppx.create({
    methods: [tempo({ account })],
    fetch,
    onChallenge: async (challenge) => {
      const req = (challenge as { request?: { amount?: string; currency?: string; decimals?: number } }).request ?? {};
      const decimals = resolveDecimals(req.decimals, req.currency, wallet.chain);
      const priceRaw = BigInt(req.amount ?? '0');
      const priceUsd = Number(priceRaw) / 10 ** decimals;
      settled.price_usd = priceUsd.toFixed(decimals);
      if (input.maxSpendUsd !== undefined && priceUsd > input.maxSpendUsd) {
        throw new CliError(
          'max_spend_exceeded',
          `Payment ${priceUsd} USDC exceeds --max-spend ${input.maxSpendUsd}`,
          { extra: { price_usd: priceUsd, max_spend_usd: input.maxSpendUsd } },
        );
      }
      const verdict = await enforce(limits, { priceUsd, host });
      if (!verdict.allowed) {
        throw new CliError('limit_exceeded', `Local limit violated: ${verdict.violated}=${verdict.limit}`, {
          extra: { violated: verdict.violated, limit: verdict.limit, would_be: verdict.would_be },
        });
      }
      return undefined;
    },
  });
  return client.fetch(input.url, init);
}

/**
 * Stable per-invocation idempotency key. Hashes the request shape (url + method + body +
 * signer) so all retries within `withRetries` reuse the same key — merchants that honor
 * X-Idempotency-Key (Stripe-pattern dedup) won't double-charge if a payment settled but
 * the network response was lost.
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
