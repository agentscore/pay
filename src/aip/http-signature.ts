/**
 * RFC 9421 HTTP Message Signature — the AIP proof-of-possession SIGNER (client side).
 *
 * pay presents an Agent Identity Token (AIT) to a merchant by signing the request with the
 * Ed25519 key whose public half is bound in the token's `cnf` claim. This module produces the
 * `Signature-Input` + `Signature` headers the merchant's verifier checks.
 *
 * It is a self-contained port of the serialization in the AgentScore commerce verifier
 * (`the AgentScore commerce verifier`): pay must NOT depend on the heavy merchant SDK, so
 * the wire format is reproduced here with only `node:crypto`. A conformance test
 * (`tests/aip_http_signature.test.ts`) pins this byte-for-byte against that verifier, so any drift
 * fails CI.
 *
 * Covered components (canonical order): @method @authority @path agent-identity; tag
 * "agent-identity"; keyid = RFC 7638 thumbprint of the public cnf JWK; alg Ed25519.
 */
import { createHash, type KeyObject, sign as nodeSign } from 'crypto';

/** The AIP "minimum required" covered components, in canonical order. */
export const AIP_COVERED_COMPONENTS = ['@method', '@authority', '@path', 'agent-identity'] as const;

/** Tag that identifies the AIP signature among coexisting RFC 9421 signatures. */
export const AIP_SIGNATURE_TAG = 'agent-identity';

/** Default signature validity window (seconds). The AIP spec presents `created` + `expires` with a
 *  recommended ~60s window; emit `expires = created + 60` so the signature carries an explicit expiry. */
const DEFAULT_SIGNATURE_TTL_SECONDS = 60;

/** Public Ed25519 JWK (the form bound in `cnf` and thumbprinted for keyid). */
export interface Ed25519PublicJwk {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
}

interface SignatureParams {
  components: string[];
  created?: number;
  expires?: number;
  keyid: string;
  tag: string;
}

/**
 * RFC 7638 JWK thumbprint of an Ed25519 public JWK: sha256 over the canonical JSON
 * `{"crv","kty","x"}` (lexicographic, no whitespace), base64url. Matches jose's
 * `calculateJwkThumbprint(jwk,'sha256')` byte-for-byte (verified).
 */
export function jwkThumbprint(jwk: Ed25519PublicJwk): string {
  const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}"}`;
  return createHash('sha256').update(canonical).digest('base64url');
}

/**
 * Normalize an authority for `@authority` per RFC 9421 §2.2.3: lowercase, drop the default port.
 * Scheme is unknown here, so drop the common defaults (80/443). Mirrors the verifier exactly.
 */
function normalizeAuthority(authority: string): string {
  const lower = authority.trim().toLowerCase();
  const colon = lower.lastIndexOf(':');
  if (colon === -1) return lower;
  if (lower.includes(']') && colon < lower.indexOf(']')) return lower; // IPv6 literal, no port
  const port = lower.slice(colon + 1);
  if (port === '80' || port === '443') return lower.slice(0, colon);
  return lower;
}

function componentValue(name: string, input: SignInput): string {
  switch (name) {
    case '@method':
      return input.method.toUpperCase();
    case '@authority':
      return normalizeAuthority(input.authority);
    case '@path':
      return input.path;
    case 'agent-identity':
      return input.agentIdentity.trim();
    default:
      throw new Error(`unsupported covered component: ${name}`);
  }
}

const serializeComponentList = (components: string[]): string =>
  `(${components.map((c) => `"${c}"`).join(' ')})`;

/** Serialize the `;k=v` params suffix in canonical order (must match the verifier). */
function serializeParams(p: SignatureParams): string {
  const parts: string[] = [];
  if (p.created !== undefined) parts.push(`created=${p.created}`);
  if (p.expires !== undefined) parts.push(`expires=${p.expires}`);
  parts.push(`keyid="${p.keyid}"`);
  parts.push(`tag="${p.tag}"`);
  return parts.map((s) => `;${s}`).join('');
}

/**
 * Build the RFC 9421 signature base: one line per covered component, then the
 * `@signature-params` line. Joined by `\n`, no trailing newline.
 */
function buildSignatureBase(params: SignatureParams, input: SignInput): string {
  const lines = params.components.map((name) => `"${name}": ${componentValue(name, input)}`);
  lines.push(`"@signature-params": ${serializeComponentList(params.components)}${serializeParams(params)}`);
  return lines.join('\n');
}

interface SignInput {
  method: string;
  authority: string;
  path: string;
  agentIdentity: string;
}

export interface SignAitRequestInput extends SignInput {
  /** Ed25519 private key (node:crypto KeyObject) whose public half is the cnf key. */
  privateKey: KeyObject;
  /** Public cnf JWK (used to derive the keyid thumbprint). */
  publicJwk: Ed25519PublicJwk;
  /** Signature creation time (unix seconds); defaults to now. */
  created?: number;
  /** Optional expiry (unix seconds). */
  expires?: number;
  /** Signature dictionary label; defaults to "ait". */
  label?: string;
}

/**
 * Sign an outgoing merchant request for AIT proof-of-possession. Returns the three headers to
 * attach: the AIT itself plus the RFC 9421 `Signature-Input` / `Signature`.
 */
export function signAitRequest(input: SignAitRequestInput): {
  agentIdentity: string;
  signatureInput: string;
  signature: string;
} {
  const label = input.label ?? 'ait';
  const components = [...AIP_COVERED_COMPONENTS];
  const created = input.created ?? Math.floor(Date.now() / 1000);
  const expires = input.expires ?? created + DEFAULT_SIGNATURE_TTL_SECONDS;
  const keyid = jwkThumbprint(input.publicJwk);

  const params: SignatureParams = {
    components,
    created,
    expires,
    keyid,
    tag: AIP_SIGNATURE_TAG,
  };

  const base = buildSignatureBase(params, input);
  // Ed25519 (EdDSA): node:crypto sign with a null algorithm over the raw base bytes.
  const sigBytes = nodeSign(null, Buffer.from(base, 'utf8'), input.privateKey);
  const b64 = sigBytes.toString('base64');

  return {
    agentIdentity: input.agentIdentity,
    signatureInput: `${label}=${serializeComponentList(components)}${serializeParams(params)}`,
    signature: `${label}=:${b64}:`,
  };
}
