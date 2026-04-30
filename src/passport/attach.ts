import { isExpired, loadPassport, type Passport } from './storage';

/**
 * Attaches the stored AgentScore Passport's operator_token to outgoing merchant
 * requests. Used on every settle leg of `pay <url>` so agents with a stored
 * Passport never have to manually pass `--header X-Operator-Token: opc_...`.
 *
 * Decision tree:
 *   1. `--no-passport` opt-out → skip
 *   2. No Passport stored → skip silently (cold-start path; bootstrap.ts handles
 *      the merchant 403 if it comes; otherwise the request flows anonymously)
 *   3. Passport hard-expired → return `{ kind: 'expired' }` so the caller can
 *      drive inline reauth via bootstrap.ts (Phase 2). Don't attach.
 *   4. Passport valid → attach `X-Operator-Token` (caller may still merge with a
 *      caller-supplied X-Operator-Token; caller-supplied wins)
 */

export interface AttachResult {
  kind: 'attached' | 'expired' | 'absent' | 'opted_out';
  passport?: Passport;
  /** Header value to set as `X-Operator-Token`, when kind === 'attached'. */
  operatorToken?: string;
  /** True when expires_at - now < 5 days (informational warning, not a block). */
  expiringSoon?: boolean;
}

export interface AttachInput {
  /** Set to true to skip attach entirely (caller is doing explicit-anonymous). */
  noPassport?: boolean;
  /** Caller-supplied X-Operator-Token already present on the request — don't override. */
  callerSuppliedOperatorToken?: string;
  /** Override "now" for testing. */
  now?: number;
}

const SOFT_EXPIRY_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;

export async function attachPassport(input: AttachInput = {}): Promise<AttachResult> {
  if (input.noPassport) return { kind: 'opted_out' };
  if (input.callerSuppliedOperatorToken) {
    // Caller is providing their own token; respect it, don't read or attach passport.
    return { kind: 'opted_out' };
  }

  const passport = await loadPassport();
  if (!passport) return { kind: 'absent' };

  const now = input.now ?? Date.now();
  if (isExpired(passport, now)) {
    return { kind: 'expired', passport };
  }

  const expiringSoon = passport.expires_at - now < SOFT_EXPIRY_WINDOW_MS;
  return {
    kind: 'attached',
    passport,
    operatorToken: passport.operator_token,
    expiringSoon,
  };
}

/**
 * Convenience: builds the headers patch to merge into a fetch's headers.
 * Returns `{}` when nothing should be attached.
 */
export function attachResultToHeaders(result: AttachResult): Record<string, string> {
  if (result.kind !== 'attached' || !result.operatorToken) return {};
  return { 'X-Operator-Token': result.operatorToken };
}
