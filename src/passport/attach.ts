import { refreshAccessToken } from './auth';
import { isExpired, loadPassport, type Passport } from './storage';

/**
 * Attach the stored Passport's operator_token to outgoing merchant requests
 * on the settle leg, with silent refresh near expiry. Caller-supplied
 * X-Operator-Token always wins.
 */

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
