import { AgentScoreError, type SessionCreateResponse, type SessionPollResponse } from '@agent-score/sdk';
import { CliError } from '../errors';
import { type Passport, savePassport } from './storage';

/**
 * Drives the AgentScore Passport login flow:
 *   1. POST /v1/sessions/public  → returns verify_url + session_id + poll_secret
 *      (NO AgentScore API key required. The public endpoint is gated by:
 *       - Required X-Client-Id header validated against an allowlist of
 *         registered buyer-side tools (pay carries PUBLIC_CLIENT_ID below)
 *       - Per-IP rate limit (5/hour) + active-pending cap (10)
 *       Combined: server-side merchant traffic can't trivially bypass the
 *       paid /v1/sessions endpoint via this path.)
 *   2. Poll GET /v1/sessions/{id} with X-Poll-Secret  → until status === 'verified'
 *   3. Persist the resulting operator_token to the local keystore
 *
 * Inlined directly here (not via the SDK) so the public endpoint stays
 * exclusive to registered buyer-side tools — exposing it as an SDK method
 * would let any consumer bypass the paid path.
 *
 * v1 long-lived opc_ (30d default per AgentScore policy). v3 (refresh tokens)
 * extends Passport with refresh_token + access_expires_at and adjusts attach.ts
 * to silent-refresh; this file stays the entry-point for cold logins.
 */

const POLL_BASE_URL = process.env.AGENTSCORE_BASE_URL ?? 'https://api.agentscore.sh';

/**
 * pay's public client identifier — sent as `X-Client-Id` on /v1/sessions/public
 * requests. Registered with the AgentScore API's allowlist. This identifier is
 * deliberately public (visible in pay's published binary) — the defense isn't
 * secrecy, it's "this header MUST be a registered buyer-side tool, and adding
 * a new entry to the server allowlist is a deliberate registration step."
 *
 * Bumped on incompatible API contract changes for the public endpoint.
 */
const PUBLIC_CLIENT_ID = 'agentscore_pay_pubclient_v1';

export interface PassportLoginInput {
  /** Polling cadence in seconds. Default 5. */
  pollIntervalSeconds?: number;
  /** Polling timeout in seconds. Default 3600 (1 hour). */
  timeoutSeconds?: number;
  /** Override base URL (testing). */
  baseUrl?: string;
  /** Override fetch (testing). */
  fetch?: typeof globalThis.fetch;
  /** Hook called once with the verify URL — terminal prints it for the user. */
  onVerifyUrl?: (verifyUrl: string) => void;
  /** Hook called on every poll iteration (for a TTY spinner / progress event). */
  onPoll?: (info: { attempt: number; status: string }) => void;
}

export interface PassportLoginResult {
  passport: Passport;
  /** Raw poll response that produced the operator_token (for status display). */
  pollResponse: SessionPollResponse;
}

export async function passportLogin(input: PassportLoginInput = {}): Promise<PassportLoginResult> {
  const baseUrl = (input.baseUrl ?? POLL_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = input.fetch ?? globalThis.fetch;

  const session = await callSafely(() =>
    mintPublicSession({ baseUrl, fetch: fetchImpl }),
  );

  return pollAndStore({
    sessionId: session.session_id,
    pollSecret: session.poll_secret,
    verifyUrl: session.verify_url,
    baseUrl,
    fetch: fetchImpl,
    pollIntervalSeconds: input.pollIntervalSeconds,
    timeoutSeconds: input.timeoutSeconds,
    onVerifyUrl: input.onVerifyUrl,
    onPoll: input.onPoll,
  });
}

/**
 * Resume a verification session that someone else already minted (typically
 * the merchant's gate, surfaced in a 403 with `verify_url` + `session_id` +
 * `poll_secret`). The cold-start auto-bootstrap flow inside `pay <url>`
 * calls this so an agent that hits a fresh AgentScore-gated merchant gets
 * the operator_token without needing a prior `pay passport login`.
 *
 * Same poll-and-store machinery as `passportLogin`; only the session source
 * differs.
 */
export interface PassportResumeInput {
  sessionId: string;
  pollSecret: string;
  verifyUrl: string;
  /** Optional poll URL from the merchant 403 — falls back to baseUrl-derived. */
  pollUrl?: string;
  pollIntervalSeconds?: number;
  timeoutSeconds?: number;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  onVerifyUrl?: (verifyUrl: string) => void;
  onPoll?: (info: { attempt: number; status: string }) => void;
}

export async function passportResume(input: PassportResumeInput): Promise<PassportLoginResult> {
  // If pollUrl points to a different host than our default baseUrl, derive baseUrl from it.
  let baseUrl = (input.baseUrl ?? POLL_BASE_URL).replace(/\/+$/, '');
  if (input.pollUrl) {
    const m = input.pollUrl.match(/^(https?:\/\/[^/]+)/);
    if (m && m[1]) baseUrl = m[1];
  }
  return pollAndStore({
    sessionId: input.sessionId,
    pollSecret: input.pollSecret,
    verifyUrl: input.verifyUrl,
    baseUrl,
    fetch: input.fetch ?? globalThis.fetch,
    pollIntervalSeconds: input.pollIntervalSeconds,
    timeoutSeconds: input.timeoutSeconds,
    onVerifyUrl: input.onVerifyUrl,
    onPoll: input.onPoll,
  });
}

/**
 * Shared poll-and-store machinery for both flavors of session bootstrap:
 *   - `passportLogin`     (mint via /v1/sessions/public, then poll)
 *   - `passportResume`    (use a merchant-supplied session, just poll)
 * Both converge here once they have a (sessionId, pollSecret, verifyUrl)
 * triple to consume.
 */
async function pollAndStore(input: {
  sessionId: string;
  pollSecret: string;
  verifyUrl: string;
  baseUrl: string;
  fetch: typeof globalThis.fetch;
  pollIntervalSeconds?: number;
  timeoutSeconds?: number;
  onVerifyUrl?: (verifyUrl: string) => void;
  onPoll?: (info: { attempt: number; status: string }) => void;
}): Promise<PassportLoginResult> {
  if (input.onVerifyUrl) input.onVerifyUrl(input.verifyUrl);

  const pollIntervalMs = (input.pollIntervalSeconds ?? 5) * 1000;
  const deadline = Date.now() + (input.timeoutSeconds ?? 3600) * 1000;

  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    const poll = await callSafely(() => pollPublicSession({
      sessionId: input.sessionId,
      pollSecret: input.pollSecret,
      baseUrl: input.baseUrl,
      fetch: input.fetch,
    }));
    if (input.onPoll) input.onPoll({ attempt, status: poll.status });

    if (poll.status === 'verified' && poll.operator_token) {
      const ttlSeconds = poll.token_ttl_seconds ?? 24 * 60 * 60;
      // Phase 3: self-serve sessions (pay passport login + bootstrap) issue
      // a rotating refresh_token alongside the access opc_. Save both so
      // attach.ts can silently refresh near expiry instead of forcing a
      // re-verify.
      const pollExtra = poll as SessionPollResponse & {
        refresh_token?: string;
        refresh_token_ttl_seconds?: number;
      };
      const refreshTtlSeconds = pollExtra.refresh_token_ttl_seconds ?? 90 * 24 * 60 * 60;
      const passport: Passport = {
        version: 1,
        operator_token: poll.operator_token,
        expires_at: Date.now() + ttlSeconds * 1000,
        saved_at: Date.now(),
        ...(pollExtra.refresh_token
          ? {
              refresh_token: pollExtra.refresh_token,
              refresh_expires_at: Date.now() + refreshTtlSeconds * 1000,
            }
          : {}),
      };
      await savePassport(passport);
      return { passport, pollResponse: poll };
    }

    if (poll.status === 'denied' || poll.status === 'failed') {
      throw new CliError('passport_verification_failed', `Passport verification ${poll.status}.`, {
        nextSteps: { action: 'retry_login', suggestion: 'Run `pay passport login` again.' },
        extra: { session_id: input.sessionId, status: poll.status },
      });
    }

    await sleep(pollIntervalMs);
  }

  throw new CliError('passport_verification_timeout', 'Passport verification timed out.', {
    nextSteps: { action: 'retry_login', suggestion: 'Run `pay passport login` again — sessions stay alive for 1 hour by default; you can resume the same session URL if it has not expired.' },
    extra: { session_id: input.sessionId, verify_url: input.verifyUrl },
  });
}

/**
 * Silently exchange a refresh_token for a fresh access opc_ + new rotating
 * refresh_token. Inlined here (not via the SDK) so the refresh path stays
 * exclusive to registered buyer-side tools — same security posture as
 * /v1/sessions/public.
 *
 * Returns the new Passport (already saved) on success. Throws when the
 * refresh_token is revoked / expired / unknown — caller (attach.ts) should
 * fall through to the inline reauth flow (Phase 2's bootstrapFromExpiry).
 */
export interface RefreshAccessTokenInput {
  refreshToken: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export async function refreshAccessToken(input: RefreshAccessTokenInput): Promise<Passport> {
  const baseUrl = (input.baseUrl ?? POLL_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = input.fetch ?? globalThis.fetch;

  const response = await fetchImpl(`${baseUrl}/v1/sessions/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': '@agent-score/pay',
      'X-Client-Id': PUBLIC_CLIENT_ID,
    },
    body: JSON.stringify({ refresh_token: input.refreshToken }),
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

  const result = JSON.parse(body) as {
    operator_token: string;
    token_ttl_seconds: number;
    refresh_token: string;
    refresh_token_ttl_seconds: number;
  };

  const passport: Passport = {
    version: 1,
    operator_token: result.operator_token,
    expires_at: Date.now() + result.token_ttl_seconds * 1000,
    saved_at: Date.now(),
    refresh_token: result.refresh_token,
    refresh_expires_at: Date.now() + result.refresh_token_ttl_seconds * 1000,
  };
  await savePassport(passport);
  return passport;
}

/**
 * POST /v1/sessions/public — mint a session with no API key. Inlined here so
 * the public endpoint stays exclusive to registered buyer-side tools (no SDK
 * surface that any consumer can call to bypass /v1/sessions billing).
 */
async function mintPublicSession(input: {
  baseUrl: string;
  fetch: typeof globalThis.fetch;
}): Promise<SessionCreateResponse> {
  const response = await input.fetch(`${input.baseUrl}/v1/sessions/public`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': '@agent-score/pay',
      'X-Client-Id': PUBLIC_CLIENT_ID,
    },
    body: JSON.stringify({
      context: 'pay passport login',
      product_name: '@agent-score/pay',
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
  return JSON.parse(body) as SessionCreateResponse;
}

/**
 * Poll a session minted via the public endpoint. The /v1/sessions/{id} GET path
 * is the same for merchant + public sessions (gated by X-Poll-Secret), so we
 * don't need a separate SDK method — but since we're not constructing an
 * authenticated client here, we hit it via raw fetch.
 */
async function pollPublicSession(input: {
  sessionId: string;
  pollSecret: string;
  baseUrl: string;
  fetch: typeof globalThis.fetch;
}): Promise<SessionPollResponse> {
  const response = await input.fetch(
    `${input.baseUrl}/v1/sessions/${encodeURIComponent(input.sessionId)}`,
    {
      method: 'GET',
      headers: {
        'X-Poll-Secret': input.pollSecret,
        'User-Agent': '@agent-score/pay',
      },
    },
  );
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
  return JSON.parse(body) as SessionPollResponse;
}

async function callSafely<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    if (err instanceof CliError) throw err;
    if (err instanceof AgentScoreError) {
      throw new CliError('passport_api_error', err.message, {
        extra: { code: err.code, status: err.status, ...(err.details ?? {}) },
      });
    }
    if (err instanceof Error) {
      throw new CliError('network_error', err.message);
    }
    throw new CliError('network_error', String(err));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
