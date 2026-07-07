/**
 * AIP presenter for the `pay` flow: mint an Agent Identity Token ONCE, then re-sign the outgoing
 * request per attempt.
 *
 * The AIT itself is valid for its full TTL (~300s), but the RFC 9421 proof-of-possession signature
 * carries a short `created`/`expires` window (~60s). The payment round-trip (discovery 402 +
 * settle) and any network retry can span more than one signing window, so we mint the token once
 * (the network call) and hand back a `sign()` closure that produces fresh signature headers for
 * each attempt locally (no extra network, no re-mint).
 */
import { getOrCreateAgentKey } from './agent-key';
import { signAitRequest } from './http-signature';
import { inferTrustLevel, mintAit, type TrustLevel } from './mint';

export interface AipRequestDescriptor {
  method: string;
  authority: string;
  path: string;
}

export interface AipPresenterOptions {
  operatorToken: string;
  passphrase: string;
  /** Agent platform for the `agent.provider` claim (default: agentscore-pay). */
  provider?: string;
  /** Override the inferred trust level (default: TTY → human_present, else autonomous). */
  trustLevel?: TrustLevel;
  /** Optional intent description carried in the minted token (see `--intent`). */
  intent?: string;
  /** Machine-readable intent actions (e.g. `['purchase']`) carried in `intent.actions`. */
  actions?: string[];
  /** Authentication context for `human_confirmed` (`auth.amr` MUST carry ≥1 value). */
  auth?: { amr?: string[]; time?: number };
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export type AipHeaders = { 'Agent-Identity': string; 'Signature-Input': string; Signature: string };

export interface AipPresenter {
  /** Seconds until the AIT expires. */
  expiresIn: number;
  trustLevel: TrustLevel;
  /** Issuer (`iss`) decoded from the minted token, for display/dry-run visibility. */
  issuer?: string;
  /** Subject (`sub`) decoded from the minted token, for display/dry-run visibility. */
  subject?: string;
  /** Sign `request` for proof-of-possession. Safe to call repeatedly; each call mints a fresh
   *  signature window over the same token. */
  sign(request: AipRequestDescriptor): AipHeaders;
}

/** Decode a JWT payload without verifying (display-only; the merchant + API re-verify the token). */
function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1]!, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Mint an AIT bound to pay's agent key and return a presenter that re-signs per request attempt.
 */
export async function createAipPresenter(opts: AipPresenterOptions): Promise<AipPresenter> {
  const { privateKey, publicJwk } = await getOrCreateAgentKey(opts.passphrase);
  const trustLevel = opts.trustLevel ?? inferTrustLevel();

  const { token, expiresIn } = await mintAit({
    operatorToken: opts.operatorToken,
    cnfJwk: publicJwk,
    provider: opts.provider ?? 'agentscore-pay',
    trustLevel,
    ...(opts.intent !== undefined && { intent: opts.intent }),
    ...(opts.actions !== undefined && { actions: opts.actions }),
    ...(opts.auth !== undefined && { auth: opts.auth }),
    ...(opts.baseUrl !== undefined && { baseUrl: opts.baseUrl }),
    ...(opts.fetch !== undefined && { fetch: opts.fetch }),
  });

  const claims = decodeJwtPayload(token);

  return {
    expiresIn,
    trustLevel,
    issuer: typeof claims?.iss === 'string' ? claims.iss : undefined,
    subject: typeof claims?.sub === 'string' ? claims.sub : undefined,
    sign(request: AipRequestDescriptor): AipHeaders {
      const signed = signAitRequest({
        method: request.method,
        authority: request.authority,
        path: request.path,
        agentIdentity: token,
        privateKey,
        publicJwk,
      });
      return {
        'Agent-Identity': signed.agentIdentity,
        'Signature-Input': signed.signatureInput,
        Signature: signed.signature,
      };
    },
  };
}
