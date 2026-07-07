/**
 * High-level AIP presentation: mint an AIT bound to pay's agent key, then sign a specific outgoing
 * request so a merchant can verify proof-of-possession. Ties together the agent key, the mint
 * client, and the RFC 9421 signer.
 */
import { createAipPresenter } from './presenter';
import type { TrustLevel } from './mint';

export interface PresentAitInput {
  operatorToken: string;
  passphrase: string;
  /** The request the AIT will be presented on (its method/authority/path are signed). */
  request: { method: string; authority: string; path: string };
  provider?: string;
  /** Override the inferred trust level (default: TTY → human_present, else autonomous). */
  trustLevel?: TrustLevel;
  /** Optional intent description carried in the minted token. */
  intent?: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export interface PresentedAit {
  /** Headers to attach to the merchant request. */
  headers: { 'Agent-Identity': string; 'Signature-Input': string; Signature: string };
  /** Seconds until the AIT expires. */
  expiresIn: number;
  trustLevel: TrustLevel;
}

/**
 * Mint a fresh AIT and produce the three headers (`Agent-Identity`, `Signature-Input`,
 * `Signature`) to present it on `request`. AITs are short-lived, so this mints on demand rather
 * than persisting a token.
 */
export async function presentAit(input: PresentAitInput): Promise<PresentedAit> {
  const presenter = await createAipPresenter({
    operatorToken: input.operatorToken,
    passphrase: input.passphrase,
    ...(input.provider !== undefined && { provider: input.provider }),
    ...(input.trustLevel !== undefined && { trustLevel: input.trustLevel }),
    ...(input.intent !== undefined && { intent: input.intent }),
    ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl }),
    ...(input.fetch !== undefined && { fetch: input.fetch }),
  });

  return {
    headers: presenter.sign(input.request),
    expiresIn: presenter.expiresIn,
    trustLevel: presenter.trustLevel,
  };
}
