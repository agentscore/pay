import { refreshAccessToken } from './auth';
import { isExpired, loadPassport, type Passport } from './storage';

/**
 * Attach the stored Passport's operator_token to outgoing merchant requests
 * on the settle leg, with silent refresh near expiry. Caller-supplied
 * X-Operator-Token always wins.
 */

/**
 * Proactive-refresh trigger window. Fire silent refresh when the access
 * token is within this window of expiry, even if it hasn't expired yet —
 * gives clock-skew + on-the-wire-latency headroom so a token doesn't
 * expire between attach and merchant validation. Distinct from the
 * reactive case (access already expired), which always attempts refresh
 * when the refresh_token is still valid.
 */
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

export interface AttachResult {
  kind: 'attached' | 'expired' | 'absent' | 'opted_out';
  passport?: Passport;
  /** Header value to set as `X-Operator-Token`, when kind === 'attached'. */
  operatorToken?: string;
  /**
   * Informational warning that the *user* needs to re-verify in browser
   * soon. False when a refresh_token is still comfortably valid (pay
   * will rotate silently — no user action). True only when access is
   * near expiry AND refresh is unavailable or also near expiry.
   */
  expiringSoon?: boolean;
}

export interface AttachInput {
  /** Set to true to skip attach entirely (caller is doing explicit-anonymous). */
  skipPassport?: boolean;
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
  if (input.skipPassport) return { kind: 'opted_out' };
  if (input.callerSuppliedOperatorToken) {
    // Caller is providing their own token; respect it, don't read or attach passport.
    return { kind: 'opted_out' };
  }

  let passport = await loadPassport();
  if (!passport) return { kind: 'absent' };

  const now = input.now ?? Date.now();
  const accessExpired = isExpired(passport, now);
  const accessNearExpiry = !accessExpired && passport.expires_at - now < REFRESH_THRESHOLD_MS;
  const hasUsableRefresh =
    !!passport.refresh_token
    && (passport.refresh_expires_at == null || passport.refresh_expires_at > now);

  // Try silent refresh in two cases:
  //   - Reactive: access has already expired but refresh_token is still
  //     valid (the dominant real-world case — agent comes back after the
  //     24h access TTL but well within the 90d refresh TTL).
  //   - Proactive: access within REFRESH_THRESHOLD_MS of expiry; rotates
  //     before the merchant sees a near-expired token.
  if ((accessExpired || accessNearExpiry) && hasUsableRefresh && !input.skipRefresh) {
    try {
      passport = await refreshAccessToken({
        refreshToken: passport.refresh_token!,
        baseUrl: input.baseUrl,
        fetch: input.fetch,
      });
    } catch {
      // Refresh failed (e.g., refresh_token was revoked or already
      // rotated by another process). Fall through; if access is still
      // expired below, the caller drives bootstrap reauth.
    }
  }

  if (isExpired(passport, now)) {
    return { kind: 'expired', passport };
  }

  // `expiringSoon` is the signal that the *user* needs to take action
  // (re-verify in browser). With a refresh_token still comfortably valid,
  // pay rotates silently and the user has nothing to do — don't print the
  // misleading "run passport login" warning. Only set it when access is
  // near expiry AND refresh is unavailable / also near expiry.
  const refreshWillSaveUs =
    !!passport.refresh_token
    && (passport.refresh_expires_at == null
      || passport.refresh_expires_at - now > SOFT_EXPIRY_WINDOW_MS);
  const expiringSoon =
    !refreshWillSaveUs && passport.expires_at - now < SOFT_EXPIRY_WINDOW_MS;
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
