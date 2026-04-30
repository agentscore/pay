import { AgentScore, AgentScoreError, type SessionPollResponse } from '@agent-score/sdk';
import { CliError } from '../errors';
import { type Passport, savePassport } from './storage';

/**
 * Drives the AgentScore Passport login flow:
 *   1. POST /v1/sessions  → returns verify_url + session_id + poll_secret
 *   2. Poll GET /v1/sessions/{id} with X-Poll-Secret  → until status === 'verified'
 *   3. Persist the resulting operator_token + verified facts to the keystore
 *
 * v1 long-lived opc_ (30d default per AgentScore policy). v3 (refresh tokens)
 * extends Passport with refresh_token + access_expires_at and adjusts attach.ts
 * to silent-refresh; this file stays the entry-point for cold logins.
 */

export interface PassportLoginInput {
  apiKey: string;
  /** Optional pre-existing AgentScore wallet to associate with the session. */
  address?: string;
  /** Optional pre-existing operator token (refresh-style mint). */
  operatorToken?: string;
  /** Polling cadence in seconds. Default 5. */
  pollIntervalSeconds?: number;
  /** Polling timeout in seconds. Default 3600 (1 hour). */
  timeoutSeconds?: number;
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

export async function passportLogin(input: PassportLoginInput): Promise<PassportLoginResult> {
  const client = new AgentScore({ apiKey: input.apiKey, userAgent: '@agent-score/pay' });

  const session = await callSafely(() =>
    client.createSession({
      ...(input.address ? { address: input.address } : {}),
      ...(input.operatorToken ? { operator_token: input.operatorToken } : {}),
      context: 'pay passport login',
      product_name: '@agent-score/pay',
    }),
  );

  if (input.onVerifyUrl) input.onVerifyUrl(session.verify_url);

  const pollIntervalMs = (input.pollIntervalSeconds ?? 5) * 1000;
  const deadline = Date.now() + (input.timeoutSeconds ?? 3600) * 1000;

  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    const poll = await callSafely(() => client.pollSession(session.session_id, session.poll_secret));
    if (input.onPoll) input.onPoll({ attempt, status: poll.status });

    if (poll.status === 'verified' && poll.operator_token) {
      const ttlSeconds = poll.token_ttl_seconds ?? 30 * 24 * 60 * 60; // 30d default
      const passport: Passport = {
        version: 1,
        operator_token: poll.operator_token,
        expires_at: Date.now() + ttlSeconds * 1000,
        saved_at: Date.now(),
      };
      await savePassport(passport);
      return { passport, pollResponse: poll };
    }

    if (poll.status === 'denied' || poll.status === 'failed') {
      throw new CliError('passport_verification_failed', `Passport verification ${poll.status}.`, {
        nextSteps: { action: 'retry_login', suggestion: 'Run `pay passport login` again.' },
        extra: { session_id: session.session_id, status: poll.status },
      });
    }

    await sleep(pollIntervalMs);
  }

  throw new CliError('passport_verification_timeout', 'Passport verification timed out.', {
    nextSteps: { action: 'retry_login', suggestion: 'Run `pay passport login` again — sessions stay alive for 1 hour by default; you can resume the same session URL if it has not expired.' },
    extra: { session_id: session.session_id, verify_url: session.verify_url },
  });
}

async function callSafely<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    if (err instanceof CliError) throw err;
    if (err instanceof AgentScoreError) {
      if (err.status === 401) {
        throw new CliError('config_error', `AgentScore auth error: ${err.message}`, {
          nextSteps: { action: 'check_api_key', suggestion: 'Confirm AGENTSCORE_API_KEY is valid.' },
          extra: { code: err.code, status: err.status, ...(err.details ?? {}) },
        });
      }
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
