import { refreshAccessToken } from './auth';
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
 *   4. Passport access token within REFRESH_THRESHOLD of expiry AND we have
 *      a refresh_token → silently refresh in-place. The new opc_ + new rotating
 *      refresh_token are saved before returning. User-visible UX: nothing.
 *      On refresh failure (revoked / expired refresh_token / network blip),
 *      surface `kind: 'expired'` so caller drives Phase 2 inline reauth.
 *   5. Passport valid → attach `X-Operator-Token` (caller may still merge with a
 *      caller-supplied X-Operator-Token; caller-supplied wins)
 */

/** Silent-refresh window: when access token has < this many ms left, refresh
 *  proactively so the request lands with a fresh token instead of one that may
 *  expire mid-flight. 60s covers any reasonable merchant request latency. */
const REFRESH_THRESHOLD_MS = 60 * 1000;

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
  /** Override fetch (testing). */
  fetch?: typeof globalThis.fetch;
  /** Override base URL (testing). */
  baseUrl?: string;
  /** Skip silent refresh (testing). Default false. */
  skipRefresh?: boolean;
}

const SOFT_EXPIRY_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;

export async function attachPassport(input: AttachInput = {}): Promise<AttachResult> {
  if (input.noPassport) return { kind: 'opted_out' };
  if (input.callerSuppliedOperatorToken) {
    // Caller is providing their own token; respect it, don't read or attach passport.
    return { kind: 'opted_out' };
  }

  let passport = await loadPassport();
  if (!passport) return { kind: 'absent' };

  const now = input.now ?? Date.now();
  if (isExpired(passport, now)) {
    return { kind: 'expired', passport };
  }

  // Silent refresh: if the access token is within REFRESH_THRESHOLD_MS of
  // expiry AND we have a refresh_token AND the refresh_token itself is still
  // valid, swap in a fresh access token transparently. User sees nothing —
  // the request lands with a fresh opc_, the new rotating refresh_token is
  // saved, and the next call benefits from the same machinery.
  const accessNearExpiry = passport.expires_at - now < REFRESH_THRESHOLD_MS;
  const hasUsableRefresh =
    !!passport.refresh_token
    && (passport.refresh_expires_at == null || passport.refresh_expires_at > now);
  if (accessNearExpiry && hasUsableRefresh && !input.skipRefresh) {
    try {
      passport = await refreshAccessToken({
        refreshToken: passport.refresh_token!,
        baseUrl: input.baseUrl,
        fetch: input.fetch,
      });
    } catch {
      // Refresh failed (revoked / expired / network blip). Treat as hard
      // expiry so caller (pay.ts) falls through to inline reauth (Phase 2).
      return { kind: 'expired', passport };
    }
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
