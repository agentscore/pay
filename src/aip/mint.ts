/**
 * Mint an AgentScore Agent Identity Token (AIT) from the passport `operator_token`.
 *
 * pay sends X-Client-Id `agentscore_pay_pubclient_v1` when minting.
 * The issuer resolves the operator's verified identity from its passport/account and stamps the
 * derived compliance claims (id_verified, age bands, jurisdiction, sanctions) — pay does NOT and
 * cannot assert those. pay supplies only the operator_token, the agent cnf public key, and an
 * honest `trust_level` reflecting whether a human is at the terminal.
 *
 * Mirrors the conventions in `passport/auth.ts` (X-Client-Id + User-Agent headers, baseUrl
 * normalization, injectable fetch, AgentScoreError mapping).
 */
import { AgentScoreError } from '@agent-score/sdk';
import { createSecureFetch } from '../url-security';
import type { Ed25519PublicJwk } from './http-signature';

const DEFAULT_BASE_URL = process.env.AGENTSCORE_BASE_URL ?? 'https://api.agentscore.com';
const PUBLIC_CLIENT_ID = 'agentscore_pay_pubclient_v1';

/** AIP trust level — the per-action human-authorization strength. `autonomous` (no human) and
 *  `human_present` (TTY) are inferred from terminal presence; `human_confirmed` is set only when the
 *  human explicitly confirms the intent at the terminal (requires auth.amr + intent.description). */
export type TrustLevel = 'autonomous' | 'human_present' | 'human_confirmed';

export interface MintAitInput {
  operatorToken: string;
  cnfJwk: Ed25519PublicJwk;
  /** Agent platform identifier for the `agent.provider` claim (e.g. "anthropic"). */
  provider: string;
  trustLevel: TrustLevel;
  /** Optional human-readable purpose, stamped into the token's `intent.description` claim. */
  intent?: string;
  /** Machine-readable intent actions (e.g. `['purchase']`), stamped into `intent.actions`. */
  actions?: string[];
  /** Authentication context for `human_confirmed` — `auth.amr` (RFC 8176) MUST carry ≥1 value
   *  (e.g. `['user']` for a terminal confirmation). The issuer rejects human_confirmed without it. */
  auth?: { amr?: string[]; time?: number };
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export interface MintedAit {
  /** The signed AIT (JWT). */
  token: string;
  /** Seconds until expiry (short-lived, ~300s). */
  expiresIn: number;
}

/**
 * POST {baseUrl}/v1/agent-identity/token. Returns the minted AIT on 201; throws AgentScoreError
 * (with the issuer's error code) otherwise.
 */
export async function mintAit(input: MintAitInput): Promise<MintedAit> {
  // `||` (not `??`): an empty/whitespace baseUrl falls back to the default rather than producing a
  // relative request URL. mintAit is exported, so guard against a caller passing ''.
  const baseUrl = ((input.baseUrl && input.baseUrl.trim()) || DEFAULT_BASE_URL).replace(/\/+$/, '');
  // The request body carries the bearer operator_token; pin redirects to the issuer origin so a
  // 307/308 can never re-send it elsewhere (undici re-issues bodies on cross-origin redirects).
  const fetchImpl = createSecureFetch({ fetch: input.fetch ?? globalThis.fetch });

  // Combine intent.description (--intent) + intent.actions into one `intent` claim, omitted entirely
  // when neither is present.
  const intentClaim: { description?: string; actions?: string[] } = {
    ...(input.intent && input.intent.trim() ? { description: input.intent.trim() } : {}),
    ...(input.actions && input.actions.length > 0 ? { actions: input.actions } : {}),
  };

  const response = await fetchImpl(`${baseUrl}/v1/agent-identity/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': '@agent-score/pay',
      'X-Client-Id': PUBLIC_CLIENT_ID,
    },
    body: JSON.stringify({
      operator_token: input.operatorToken,
      cnf_jwk: input.cnfJwk,
      agent: { provider: input.provider },
      trust_level: input.trustLevel,
      ...(input.auth ? { auth: input.auth } : {}),
      ...(Object.keys(intentClaim).length > 0 ? { intent: intentClaim } : {}),
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    let parsed: { error?: { code?: string; message?: string } } | null = null;
    try {
      parsed = body ? JSON.parse(body) : null;
    } catch {
      parsed = null;
    }
    throw new AgentScoreError(
      parsed?.error?.code ?? 'http_error',
      parsed?.error?.message ?? `HTTP ${response.status}`,
      response.status,
    );
  }

  let result: { token?: unknown; token_type?: unknown; expires_in?: unknown };
  try {
    result = JSON.parse(body) as typeof result;
  } catch {
    throw new AgentScoreError('invalid_response', 'Issuer returned a non-JSON mint response.', response.status);
  }
  if (typeof result.token !== 'string' || result.token.length === 0) {
    throw new AgentScoreError('invalid_response', 'Issuer mint response is missing the token.', response.status);
  }
  const expiresIn = typeof result.expires_in === 'number' ? result.expires_in : 0;
  return { token: result.token, expiresIn };
}

/** Honest trust level from terminal presence: TTY → human_present, else autonomous. */
export function inferTrustLevel(): TrustLevel {
  return process.stdin.isTTY && process.stdout.isTTY ? 'human_present' : 'autonomous';
}
