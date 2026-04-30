import { passportLogin, passportResume, type PassportLoginResult } from './auth';

/**
 * Inline session-acquisition flows used during a `pay <url>` settle leg when
 * the agent doesn't yet have a usable Passport. Two triggers, one shared
 * machinery (auth.ts's pollAndStore):
 *
 *   1. Cold-start bootstrap — merchant gate returned 403 with bootstrap
 *      fields (`verify_url` + `session_id` + `poll_secret`). The merchant
 *      already auto-minted a session for us; we resume it.
 *
 *   2. Mid-stream reauth on expiry — `attachPassport()` reported a stored
 *      Passport whose `expires_at` is past `now`. The stored token is dead;
 *      we mint a fresh public session ourselves and walk the user through
 *      browser verification. Same UX as cold-start; different session
 *      source. KYC is sticky on AgentScore's side, so the renewal browser
 *      flow is a one-click confirm rather than a fresh photo capture.
 *
 * Both surfaces converge on the same ergonomic: print verify URL to stderr,
 * poll, save Passport, return the new operator_token to the caller. The
 * caller (pay's settle path) is responsible for retrying the original
 * merchant request with `X-Operator-Token: <new-opc>` attached.
 */

/** Fields a merchant gate emits in a bootstrap 403 body. */
export interface MerchantBootstrapFields {
  session_id: string;
  poll_secret: string;
  verify_url: string;
  poll_url?: string;
  /** Some merchants (e.g. martin-estate) include an order_id so the retry
   *  resumes the same pending order rather than creating a new one. */
  order_id?: string;
}

/**
 * Inspect a parsed 403 body and decide whether it's a bootstrap-able denial
 * (merchant minted a session for us). Returns null when the body lacks any
 * of the required fields — caller surfaces the original error in that case.
 */
export function detectMerchantBootstrap(
  body: unknown,
): MerchantBootstrapFields | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (
    typeof b.session_id === 'string'
    && typeof b.poll_secret === 'string'
    && typeof b.verify_url === 'string'
  ) {
    return {
      session_id: b.session_id,
      poll_secret: b.poll_secret,
      verify_url: b.verify_url,
      poll_url: typeof b.poll_url === 'string' ? b.poll_url : undefined,
      order_id: typeof b.order_id === 'string' ? b.order_id : undefined,
    };
  }
  return null;
}

export interface BootstrapHooks {
  /** Hook called once with the verify URL — terminal prints it for the user. */
  onVerifyUrl?: (verifyUrl: string) => void;
  /** Hook called on every poll iteration. */
  onPoll?: (info: { attempt: number; status: string }) => void;
  /** Polling cadence in seconds. Default 5. */
  pollIntervalSeconds?: number;
  /** Polling timeout in seconds. Default 3600 (1 hour). */
  timeoutSeconds?: number;
  /** Override base URL (testing). */
  baseUrl?: string;
  /** Override fetch (testing). */
  fetch?: typeof globalThis.fetch;
}

/**
 * Cold-start bootstrap from a merchant 403 — resumes the merchant-supplied
 * session, polls until verified, saves the resulting Passport. Returns the
 * fresh result so callers can attach `X-Operator-Token` to the retry.
 */
export async function bootstrapFromMerchantSession(
  merchant: MerchantBootstrapFields,
  hooks: BootstrapHooks = {},
): Promise<PassportLoginResult> {
  return passportResume({
    sessionId: merchant.session_id,
    pollSecret: merchant.poll_secret,
    verifyUrl: merchant.verify_url,
    pollUrl: merchant.poll_url,
    pollIntervalSeconds: hooks.pollIntervalSeconds,
    timeoutSeconds: hooks.timeoutSeconds,
    baseUrl: hooks.baseUrl,
    fetch: hooks.fetch,
    onVerifyUrl: hooks.onVerifyUrl,
    onPoll: hooks.onPoll,
  });
}

/**
 * Mid-stream reauth after a stored Passport expires. Mints a fresh public
 * session and runs the same browser-redirect flow as `pay passport login`,
 * just driven inline rather than by an explicit user command. The new
 * Passport overwrites the expired one in the keystore.
 */
export async function bootstrapFromExpiry(
  hooks: BootstrapHooks = {},
): Promise<PassportLoginResult> {
  return passportLogin({
    pollIntervalSeconds: hooks.pollIntervalSeconds,
    timeoutSeconds: hooks.timeoutSeconds,
    baseUrl: hooks.baseUrl,
    fetch: hooks.fetch,
    onVerifyUrl: hooks.onVerifyUrl,
    onPoll: hooks.onPoll,
  });
}
