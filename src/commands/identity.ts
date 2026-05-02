import {
  AgentScore,
  AgentScoreError,
  InvalidCredentialError,
  PaymentRequiredError,
  QuotaExceededError,
  RateLimitedError,
  TimeoutError as SdkTimeoutError,
  TokenExpiredError,
  type AssessResponse,
  type AssociateWalletResponse,
  type CredentialCreateResponse,
  type CredentialListResponse,
  type ReputationResponse,
  type SessionCreateResponse,
  type SessionPollResponse,
} from '@agent-score/sdk';
import { CliError } from '../errors';

/**
 * Identity commands wrap the AgentScore SDK so the agent-facing CLI carries the
 * full identity surface (assess, sessions, credentials, associate-wallet,
 * reputation) alongside wallet + payment. Reachable as a stdio MCP server via
 * `agentscore-pay --mcp`.
 *
 * API key is read from AGENTSCORE_API_KEY (or --api-key per command). Errors map
 * to CliError so incur emits structured codes + exit codes uniformly.
 */

const clientCache = new Map<string, AgentScore>();

function getClient(apiKey?: string): AgentScore {
  const key = apiKey ?? process.env.AGENTSCORE_API_KEY;
  if (!key) {
    throw new CliError('config_error', 'AgentScore API key required.', {
      nextSteps: {
        action: 'set_api_key',
        suggestion: 'Set AGENTSCORE_API_KEY in your environment, or pass --api-key. Get a key at https://agentscore.sh/sign-up.',
      },
    });
  }
  let client = clientCache.get(key);
  if (!client) {
    client = new AgentScore({ apiKey: key, userAgent: '@agent-score/pay' });
    clientCache.set(key, client);
  }
  return client;
}

function wrapApiError(err: unknown): never {
  if (err instanceof CliError) throw err;

  // Branch on the SDK's typed error subclasses so the code path is what's actually true at
  // runtime, not an after-the-fact guess from .status / .code.
  if (err instanceof PaymentRequiredError) {
    throw new CliError('insufficient_balance', 'This endpoint is not enabled for your AgentScore account.', {
      nextSteps: { action: 'upgrade_plan', suggestion: 'See https://agentscore.sh/pricing.' },
      extra: { code: err.code, status: err.status },
    });
  }
  if (err instanceof TokenExpiredError) {
    throw new CliError('config_error', 'AgentScore operator token expired or revoked.', {
      nextSteps: {
        action: 'reauth',
        suggestion: 'Run `agentscore-pay passport login` to mint a fresh operator_token (no API key needed). The error envelope also includes verify_url + session_id + poll_secret for callers driving the verify/poll flow manually.',
      },
      extra: { code: err.code, status: err.status, verify_url: err.verifyUrl, session_id: err.sessionId, poll_secret: err.pollSecret },
    });
  }
  if (err instanceof InvalidCredentialError) {
    throw new CliError('config_error', 'AgentScore operator token not recognized.', {
      nextSteps: {
        action: 'switch_token_or_restart_session',
        suggestion: 'Use a different stored operator_token (drop --operator-token / X-Operator-Token), or run `agentscore-pay passport login` to mint a fresh one (no API key needed).',
      },
      extra: { code: err.code, status: err.status },
    });
  }
  if (err instanceof QuotaExceededError) {
    throw new CliError('quota_exceeded', 'AgentScore account quota exceeded.', {
      nextSteps: {
        action: 'upgrade_plan',
        suggestion: 'Your account has reached its cap. Surface to the user — agent retry will not fix this. See https://agentscore.sh/pricing.',
      },
      extra: { code: err.code, status: err.status },
    });
  }
  if (err instanceof RateLimitedError) {
    throw new CliError('network_error', `AgentScore rate limit hit: ${err.message}`, {
      nextSteps: { action: 'retry_with_backoff', suggestion: 'Retry after the Retry-After interval (typically <= 1s).' },
      extra: { code: err.code, status: err.status },
    });
  }
  if (err instanceof SdkTimeoutError) {
    throw new CliError('network_error', `AgentScore API timed out: ${err.message}`, {
      nextSteps: { action: 'retry_with_backoff', suggestion: 'Retry in 30–60s with exponential backoff.' },
      extra: { code: err.code, status: err.status },
    });
  }
  if (err instanceof AgentScoreError) {
    // 401 with no specific subclass (rare — most 401s subclass to TokenExpiredError or
    // InvalidCredentialError above). Treat as auth-config issue.
    if (err.status === 401) {
      throw new CliError('config_error', `AgentScore auth error: ${err.message}`, {
        nextSteps: { action: 'check_api_key', suggestion: 'Confirm AGENTSCORE_API_KEY is valid and not expired.' },
        extra: { code: err.code, status: err.status, ...(err.details ?? {}) },
      });
    }
    // network_error and any other generic AgentScoreError (5xx unwrapped, body parse fail).
    if (err.status === 0 || err.status >= 500 || err.code === 'api_error' || err.code === 'network_error') {
      throw new CliError('network_error', `AgentScore API error: ${err.message}`, {
        nextSteps: { action: 'retry_with_backoff', suggestion: 'Retry in 30–60s with exponential backoff.' },
        extra: { code: err.code, status: err.status },
      });
    }
    throw new CliError('merchant_error', err.message, {
      extra: { code: err.code, status: err.status, ...(err.details ?? {}) },
    });
  }
  if (err instanceof Error) {
    throw new CliError('network_error', err.message);
  }
  throw new CliError('network_error', String(err));
}

// ── reputation ──────────────────────────────────────────────────────────────
export interface ReputationInput {
  address: string;
  chain?: string;
  apiKey?: string;
}

export async function reputation(input: ReputationInput): Promise<ReputationResponse> {
  try {
    return await getClient(input.apiKey).getReputation(input.address, input.chain ? { chain: input.chain } : undefined);
  } catch (err: unknown) {
    wrapApiError(err);
  }
}

// ── assess ──────────────────────────────────────────────────────────────────
export interface AssessInput {
  address?: string;
  operatorToken?: string;
  chain?: string;
  requireKyc?: boolean;
  requireSanctionsClear?: boolean;
  minAge?: number;
  blockedJurisdictions?: string[];
  allowedJurisdictions?: string[];
  refresh?: boolean;
  apiKey?: string;
}

export async function assess(input: AssessInput): Promise<AssessResponse> {
  if (!input.address && !input.operatorToken) {
    throw new CliError('invalid_input', 'Either --address or --operator-token must be provided.');
  }
  const policy: Record<string, unknown> = {};
  if (input.requireKyc !== undefined) policy.require_kyc = input.requireKyc;
  if (input.requireSanctionsClear !== undefined) policy.require_sanctions_clear = input.requireSanctionsClear;
  if (input.minAge !== undefined) policy.min_age = input.minAge;
  if (input.blockedJurisdictions) policy.blocked_jurisdictions = input.blockedJurisdictions;
  if (input.allowedJurisdictions) policy.allowed_jurisdictions = input.allowedJurisdictions;

  const opts = {
    ...(input.operatorToken ? { operatorToken: input.operatorToken } : {}),
    ...(input.chain ? { chain: input.chain } : {}),
    ...(input.refresh !== undefined ? { refresh: input.refresh } : {}),
    ...(Object.keys(policy).length > 0 ? { policy } : {}),
  };

  const client = getClient(input.apiKey);
  try {
    return input.address
      ? await client.assess(input.address, opts)
      : await client.assess(null, { ...opts, operatorToken: input.operatorToken! });
  } catch (err: unknown) {
    wrapApiError(err);
  }
}

// ── sessions ────────────────────────────────────────────────────────────────
export interface SessionCreateInput {
  address?: string;
  operatorToken?: string;
  context?: string;
  productName?: string;
  apiKey?: string;
}

export async function sessionCreate(input: SessionCreateInput): Promise<SessionCreateResponse> {
  try {
    return await getClient(input.apiKey).createSession({
      ...(input.address ? { address: input.address } : {}),
      ...(input.operatorToken ? { operator_token: input.operatorToken } : {}),
      ...(input.context ? { context: input.context } : {}),
      ...(input.productName ? { product_name: input.productName } : {}),
    });
  } catch (err: unknown) {
    wrapApiError(err);
  }
}

export interface SessionGetInput {
  id: string;
  pollSecret?: string;
  apiKey?: string;
}

export async function sessionGet(input: SessionGetInput): Promise<SessionPollResponse> {
  try {
    return await getClient(input.apiKey).pollSession(input.id, input.pollSecret ?? '');
  } catch (err: unknown) {
    wrapApiError(err);
  }
}

// ── credentials ─────────────────────────────────────────────────────────────
export interface CredentialCreateInput {
  label?: string;
  ttlDays?: number;
  apiKey?: string;
}

export async function credentialCreate(input: CredentialCreateInput): Promise<CredentialCreateResponse> {
  try {
    return await getClient(input.apiKey).createCredential({
      ...(input.label ? { label: input.label } : {}),
      ...(input.ttlDays !== undefined ? { ttl_days: input.ttlDays } : {}),
    });
  } catch (err: unknown) {
    wrapApiError(err);
  }
}

export async function credentialList(input: { apiKey?: string } = {}): Promise<CredentialListResponse> {
  try {
    return await getClient(input.apiKey).listCredentials();
  } catch (err: unknown) {
    wrapApiError(err);
  }
}

export interface CredentialRevokeInput {
  id: string;
  apiKey?: string;
}

export interface CredentialRevokeResult {
  ok: true;
  id: string;
  revoked: true;
}

export async function credentialRevoke(input: CredentialRevokeInput): Promise<CredentialRevokeResult> {
  try {
    await getClient(input.apiKey).revokeCredential(input.id);
    return { ok: true, id: input.id, revoked: true };
  } catch (err: unknown) {
    wrapApiError(err);
  }
}

// ── associate-wallet ────────────────────────────────────────────────────────
export interface AssociateWalletInput {
  operatorToken: string;
  walletAddress: string;
  network: 'evm' | 'solana';
  idempotencyKey?: string;
  apiKey?: string;
}

export async function associateWallet(input: AssociateWalletInput): Promise<AssociateWalletResponse> {
  try {
    return await getClient(input.apiKey).associateWallet({
      operatorToken: input.operatorToken,
      walletAddress: input.walletAddress,
      network: input.network,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    });
  } catch (err: unknown) {
    wrapApiError(err);
  }
}
