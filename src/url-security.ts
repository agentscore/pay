import { CliError } from './errors';

/**
 * Credential-transport safety for the bearer Passport `operator_token`.
 *
 * The durable Passport credential is a long-lived bearer secret. It must ONLY
 * ever travel:
 *   1. over `https:` (never cleartext), and
 *   2. to the exact host the user targeted — never silently forwarded to a
 *      redirect target the merchant chose.
 *
 * On Node/undici a cross-origin `30x` strips `Authorization` and `Cookie` from
 * the followed request but FORWARDS arbitrary custom headers (including
 * `X-Operator-Token`). A hostile merchant could `302 → http://attacker/` and
 * harvest the credential. These helpers close both holes.
 */

/**
 * Loopback hosts are the dev carve-out: traffic to `localhost` / `127.0.0.1` /
 * `::1` never leaves the machine, so cleartext there can't be sniffed off the
 * wire. Everything else must be https.
 */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  // URL.hostname wraps IPv6 in brackets; strip them before comparing.
  const bare = h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;
  return bare === 'localhost' || bare === '127.0.0.1' || bare === '::1';
}

/**
 * True when it is safe to attach the bearer credential to a request for `url`:
 * the scheme is https, OR it is a loopback host over http (dev). Returns false
 * (rather than throwing) so callers that only need a yes/no — e.g. the dry-run
 * planner deciding whether to show the header — can branch without a try/catch.
 * Unparseable URLs are unsafe.
 */
export function isCredentialSafeUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:' && isLoopbackHost(u.hostname)) return true;
  return false;
}

/**
 * Throwing guard: refuse to proceed unless `url` is a credential-safe target.
 * Call this on the credentialed path BEFORE attaching `X-Operator-Token`, so an
 * `http://merchant/` target is rejected before the secret is ever serialized
 * onto the request.
 */
export function assertCredentialTarget(url: string): void {
  if (isCredentialSafeUrl(url)) return;
  let scheme = '(unparseable URL)';
  try {
    scheme = new URL(url).protocol;
  } catch {
    // keep the placeholder
  }
  throw new CliError(
    'insecure_credential_transport',
    `Refusing to attach the AgentScore Passport credential to a non-HTTPS target (${scheme}). The bearer operator_token must only travel over https.`,
    {
      nextSteps: {
        action: 'use_https_endpoint',
        suggestion:
          'Re-run against an https:// URL. (http:// is allowed only for localhost / 127.0.0.1 dev endpoints.) To call a cleartext endpoint anonymously, pass --skip-passport.',
      },
      extra: { url, scheme },
    },
  );
}

/**
 * Same-origin check used to decide whether a redirect may carry the credential.
 * Both targets must be https (the dev loopback carve-out does NOT extend to
 * following redirects — a redirect is merchant-controlled and we never relax
 * transport security on it).
 */
function sameSecureOrigin(from: URL, to: URL): boolean {
  return to.protocol === 'https:' && from.protocol === 'https:' && from.origin === to.origin;
}

/** Cap on same-origin redirect hops so a misconfigured host can't loop forever. */
const MAX_SAME_ORIGIN_REDIRECTS = 3;

export interface SecureFetchOptions {
  /** Underlying fetch (defaults to global). Tests inject a mock. */
  fetch?: typeof globalThis.fetch;
}

/**
 * A credential-safe fetch wrapper. Forces `redirect: 'manual'` so undici never
 * silently forwards `X-Operator-Token` across a merchant-controlled hop, then:
 *   - follows a redirect ONLY when it is same-origin AND https (re-issuing the
 *     same init, credential intact, capped at MAX_SAME_ORIGIN_REDIRECTS), and
 *   - throws `credential_redirect_blocked` on any cross-origin or non-https
 *     redirect (the exact attack: `302 → http://attacker/`).
 *
 * Pass this as the `fetch` to x402/MPP client wrappers so every request they
 * make on the credentialed path (initial 402 probe + the post-payment settle)
 * is guarded — the wrappers own the fetch loop, so guarding at the fetch layer
 * is the only place that covers both legs.
 */
export function createSecureFetch(opts: SecureFetchOptions = {}): typeof globalThis.fetch {
  const underlying = opts.fetch ?? globalThis.fetch;

  const secureFetch = (async (
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ): Promise<Response> => {
    let currentUrl = requestUrl(input);
    let currentInput = input;
    const currentInit: RequestInit = { ...(init ?? {}), redirect: 'manual' };

    for (let hop = 0; ; hop++) {
      const res = await underlying(currentInput, currentInit);
      if (!isRedirect(res.status)) return res;

      const location = res.headers.get('location');
      if (!location) return res; // 3xx with no Location — nothing to follow, hand it back.

      let target: URL;
      try {
        target = new URL(location, currentUrl);
      } catch {
        throw redirectBlocked(currentUrl.href, location);
      }

      if (!sameSecureOrigin(currentUrl, target)) {
        throw redirectBlocked(currentUrl.href, target.href);
      }
      if (hop + 1 > MAX_SAME_ORIGIN_REDIRECTS) {
        throw new CliError(
          'credential_redirect_blocked',
          `Refusing to follow more than ${MAX_SAME_ORIGIN_REDIRECTS} redirects while carrying the Passport credential.`,
          {
            nextSteps: {
              action: 'check_merchant_endpoint',
              suggestion: 'The endpoint is redirect-looping. Verify the URL, or pass --skip-passport to call it anonymously.',
            },
            extra: { url: currentUrl.href },
          },
        );
      }
      currentUrl = target;
      currentInput = target.href;
    }
  }) as typeof globalThis.fetch;

  return secureFetch;
}

function requestUrl(input: Parameters<typeof globalThis.fetch>[0]): URL {
  if (typeof input === 'string') return new URL(input);
  if (input instanceof URL) return input;
  // Request object
  return new URL((input as Request).url);
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function redirectBlocked(from: string, to: string): CliError {
  return new CliError(
    'credential_redirect_blocked',
    `Refusing to follow a redirect that would forward the AgentScore Passport credential off the target host (${from} → ${to}). A redirect to a different origin or to cleartext http would leak the bearer operator_token.`,
    {
      nextSteps: {
        action: 'verify_merchant_or_skip_passport',
        suggestion:
          'Only same-origin https redirects are followed with the credential attached. If this redirect is expected, call the final URL directly; otherwise pass --skip-passport to proceed anonymously.',
      },
      extra: { from, to },
    },
  );
}
