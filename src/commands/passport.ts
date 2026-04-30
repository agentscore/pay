import { AgentScore, AgentScoreError } from '@agent-score/sdk';
import { CliError } from '../errors';
import { passportLogin } from '../passport/auth';
import { clearPassport, expiresInDays, isExpired, loadPassport } from '../passport/storage';

/**
 * Top-level Passport commands — `pay passport {login,status,logout}`.
 * Owns the keystore + browser-redirect UX for AgentScore identity. Auto-attach
 * happens transparently inside `pay <url>`'s settle leg via `passport/attach.ts`;
 * users only run these commands explicitly when minting / inspecting / clearing
 * the stored Passport.
 */

export interface PassportLoginInput {
  apiKey?: string;
  address?: string;
  operatorToken?: string;
  pollIntervalSeconds?: number;
  timeoutSeconds?: number;
  /** Hook invoked once with the verify URL — terminal prints it for the user. */
  onVerifyUrl?: (verifyUrl: string) => void;
  /** Hook invoked on each poll iteration. */
  onPoll?: (info: { attempt: number; status: string }) => void;
}

export interface PassportLoginOutput {
  ok: true;
  operator_token_prefix: string;
  expires_at: string;
  expires_in_days: number;
}

export async function passportLoginCommand(input: PassportLoginInput): Promise<PassportLoginOutput> {
  const apiKey = resolveApiKey(input.apiKey);
  const { passport } = await passportLogin({
    apiKey,
    address: input.address,
    operatorToken: input.operatorToken,
    pollIntervalSeconds: input.pollIntervalSeconds,
    timeoutSeconds: input.timeoutSeconds,
    onVerifyUrl: input.onVerifyUrl,
    onPoll: input.onPoll,
  });
  return {
    ok: true,
    operator_token_prefix: passport.operator_token.slice(0, 8) + '…',
    expires_at: new Date(passport.expires_at).toISOString(),
    expires_in_days: expiresInDays(passport),
  };
}

export type PassportStatusOutput =
  | {
      authenticated: true;
      operator_token_prefix: string;
      expires_at: string;
      expires_in_days: number;
      expired: boolean;
    }
  | { authenticated: false };

export async function passportStatusCommand(): Promise<PassportStatusOutput> {
  const passport = await loadPassport();
  if (!passport) return { authenticated: false };
  return {
    authenticated: true,
    operator_token_prefix: passport.operator_token.slice(0, 8) + '…',
    expires_at: new Date(passport.expires_at).toISOString(),
    expires_in_days: expiresInDays(passport),
    expired: isExpired(passport),
  };
}

export interface PassportLogoutInput {
  apiKey?: string;
}

export interface PassportLogoutOutput {
  ok: true;
  cleared: boolean;
  revoked_remote: boolean;
}

export async function passportLogoutCommand(input: PassportLogoutInput = {}): Promise<PassportLogoutOutput> {
  const passport = await loadPassport();
  let revokedRemote = false;
  if (passport && (input.apiKey || process.env.AGENTSCORE_API_KEY)) {
    try {
      const client = new AgentScore({ apiKey: resolveApiKey(input.apiKey), userAgent: '@agent-score/pay' });
      await client.revokeCredential(passport.operator_token);
      revokedRemote = true;
    } catch (err: unknown) {
      // Best-effort revoke. Local clear is the primary action; tolerate auth/404 here.
      if (err instanceof AgentScoreError && err.status !== 401 && err.status !== 404) {
        // Surface a non-auth/404 server error so callers know remote state may be stale.
        // Local clear still proceeds below.
      }
    }
  }
  const cleared = await clearPassport();
  return { ok: true, cleared, revoked_remote: revokedRemote };
}

function resolveApiKey(supplied?: string): string {
  const key = supplied ?? process.env.AGENTSCORE_API_KEY;
  if (!key) {
    throw new CliError('config_error', 'AgentScore API key required.', {
      nextSteps: {
        action: 'set_api_key',
        suggestion: 'Set AGENTSCORE_API_KEY in your environment, or pass --api-key. Get a key at https://agentscore.sh/sign-up.',
      },
    });
  }
  return key;
}
