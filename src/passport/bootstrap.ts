import { passportLogin, passportResume, type PassportLoginResult } from './auth';

/**
 * Inline session acquisition during a `pay <url>` settle leg when the agent
 * has no usable Passport — either resuming a merchant-supplied session
 * surfaced in a 403 or minting a fresh one after the stored Passport expired.
 */

export interface MerchantBootstrapFields {
  session_id: string;
  poll_secret: string;
  verify_url: string;
  poll_url?: string;
  order_id?: string;
}

/**
 * Returns the bootstrap fields when a 403 body is bootstrap-able, else null.
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

/** Resume a session surfaced by a merchant gate's 403. */
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

/** Mint a fresh session inline after the stored Passport expired. */
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
