import { AgentScoreError, type SessionCreateResponse, type SessionPollResponse } from '@agent-score/sdk';
import { CliError } from '../errors';
import { createSecureFetch } from '../url-security';
import { type Passport, savePassport } from './storage';

/**
 * AgentScore Passport login: mint a verification session, poll it until the
 * user completes KYC in the browser, persist the resulting operator_token.
 */

const POLL_BASE_URL = process.env.AGENTSCORE_BASE_URL ?? 'https://api.agentscore.com';

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
 * Resume a verification session minted elsewhere (e.g. by a merchant gate
 * surfacing `verify_url` + `session_id` + `poll_secret` in a 403 body).
 */
export interface PassportResumeInput {
  sessionId: string;
  pollSecret: string;
  verifyUrl: string;
  /**
   * Optional poll URL from the merchant 403. Accepted for forward-compat but
   * its HOST IS NEVER TRUSTED — the poll always targets the trusted AgentScore
   * base (see passportResume). Only the session id (passed separately) is used.
   */
  pollUrl?: string;
  pollIntervalSeconds?: number;
  timeoutSeconds?: number;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  onVerifyUrl?: (verifyUrl: string) => void;
  onPoll?: (info: { attempt: number; status: string }) => void;
}

export async function passportResume(input: PassportResumeInput): Promise<PassportLoginResult> {
  // SECURITY: pin the poll + token-store host to the TRUSTED AgentScore base.
  // The merchant-supplied `pollUrl` arrives in a 403 body from an UNTRUSTED
  // merchant; adopting its host would let any hostile merchant point the poll
  // at an attacker server and poison the durable Passport with an
  // attacker-chosen operator_token (Passport poisoning). We take only the
  // session id (supplied separately, validated server-side via X-Poll-Secret)
  // and ALWAYS poll/store against the trusted base. If the merchant pollUrl's
  // host already matches the trusted base it's a legitimate bootstrap and works
  // unchanged; if it points anywhere else the host is ignored.
  const baseUrl = (input.baseUrl ?? POLL_BASE_URL).replace(/\/+$/, '');
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
 * Shared poll-and-store loop for both fresh logins and resumed sessions.
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
        nextSteps: { action: 'retry_login', suggestion: 'Run `agentscore-pay passport login` again.' },
        extra: { session_id: input.sessionId, status: poll.status },
      });
    }

    await sleep(pollIntervalMs);
  }

  throw new CliError('passport_verification_timeout', 'Passport verification timed out.', {
    nextSteps: { action: 'retry_login', suggestion: 'Run `agentscore-pay passport login` again — sessions stay alive for 1 hour by default; you can resume the same session URL if it has not expired.' },
    extra: { session_id: input.sessionId, verify_url: input.verifyUrl },
  });
}

/**
 * Exchange a refresh_token for a fresh access token + rotated refresh_token.
 * Returns the new Passport (already saved) on success; throws on failure so
 * the caller can fall through to the inline reauth flow.
 */
export interface RefreshAccessTokenInput {
  refreshToken: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export async function refreshAccessToken(input: RefreshAccessTokenInput): Promise<Passport> {
  const baseUrl = (input.baseUrl ?? POLL_BASE_URL).replace(/\/+$/, '');
  // The body carries the long-lived refresh_token; pin redirects to the IdP origin so a 307/308
  // can never re-send it elsewhere (undici re-issues bodies on cross-origin redirects).
  const fetchImpl = createSecureFetch({ fetch: input.fetch ?? globalThis.fetch });

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

/** Mint a verification session via the public endpoint (no API key). */
async function mintPublicSession(input: {
  baseUrl: string;
  fetch: typeof globalThis.fetch;
}): Promise<SessionCreateResponse> {
  const fetchImpl = createSecureFetch({ fetch: input.fetch });
  const response = await fetchImpl(`${input.baseUrl}/v1/sessions/public`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': '@agent-score/pay',
      'X-Client-Id': PUBLIC_CLIENT_ID,
    },
    body: JSON.stringify({
      context: 'pay passport login',
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
  // The X-Poll-Secret header rides this request and undici forwards custom headers across
  // cross-origin redirects — same origin-pinning as the credentialed legs above.
  const fetchImpl = createSecureFetch({ fetch: input.fetch });
  const response = await fetchImpl(
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
