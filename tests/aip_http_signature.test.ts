/**
 * Conformance test for pay's AIP RFC 9421 signer. Pins the wire format byte-for-byte against the
 * spec the AgentScore commerce verifier (node-commerce/src/aip/http-signature.ts) enforces, so any
 * drift fails CI. pay does NOT depend on the commerce SDK; instead we (1) reconstruct the exact
 * signature base the verifier builds and confirm pay's signature verifies over it with node:crypto,
 * and (2) assert the exact header serialization against fixtures.
 */
import { createPrivateKey, createPublicKey, createHash, generateKeyPairSync, verify as nodeVerify } from 'crypto';
import { describe, expect, it } from 'vitest';
import { jwkThumbprint, signAitRequest, type Ed25519PublicJwk } from '../src/aip/http-signature';

function makeKey(): { privateKey: ReturnType<typeof createPrivateKey>; publicJwk: Ed25519PublicJwk } {
  const { privateKey } = generateKeyPairSync('ed25519');
  const j = privateKey.export({ format: 'jwk' }) as { x: string };
  return { privateKey, publicJwk: { kty: 'OKP', crv: 'Ed25519', x: j.x } };
}

// Independent reimplementation of the verifier's signature-base construction (from
// node-commerce/src/aip/http-signature.ts), used only to validate pay's output. If pay's signer
// and this diverge, the Ed25519 verify below fails.
function expectedBase(params: {
  method: string; authority: string; path: string; agentIdentity: string;
  created: number; keyid: string; expires?: number;
}): string {
  const comps = ['@method', '@authority', '@path', 'agent-identity'];
  const norm = (a: string) => {
    const lower = a.trim().toLowerCase();
    const c = lower.lastIndexOf(':');
    if (c === -1) return lower;
    if (lower.includes(']') && c < lower.indexOf(']')) return lower; // IPv6 literal, no port
    const port = lower.slice(c + 1);
    return port === '80' || port === '443' ? lower.slice(0, c) : lower;
  };
  const val: Record<string, string> = {
    '@method': params.method.toUpperCase(),
    '@authority': norm(params.authority),
    '@path': params.path,
    'agent-identity': params.agentIdentity.trim(),
  };
  const lines = comps.map((c) => `"${c}": ${val[c]}`);
  const list = `(${comps.map((c) => `"${c}"`).join(' ')})`;
  const expiresVal = params.expires ?? params.created + 60; // signer defaults expires = created + 60
  const paramStr = `;created=${params.created};expires=${expiresVal};keyid="${params.keyid}";tag="agent-identity"`;
  lines.push(`"@signature-params": ${list}${paramStr}`);
  return lines.join('\n');
}

describe('signAitRequest — RFC 9421 conformance', () => {
  it('thumbprint matches the RFC 7638 canonical form', () => {
    const { publicJwk } = makeKey();
    const expected = createHash('sha256')
      .update(`{"crv":"Ed25519","kty":"OKP","x":"${publicJwk.x}"}`)
      .digest('base64url');
    expect(jwkThumbprint(publicJwk)).toBe(expected);
  });

  it('emits the exact canonical bytes for the cross-repo vector (pay signer ↔ API verifier)', () => {
    // Fixed Ed25519 test key shared with core/api's conformance test. Ed25519 is deterministic, so
    // these bytes are stable. core/api/tests/aip-http-signature-conformance.test.ts pins that the API
    // verifier ACCEPTS exactly this output — together they cross-pin pay's signer to the authoritative
    // API verifier across repos; drift on either side breaks one of the two tests.
    const privateKey = createPrivateKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: '5vqAF8eRpE9bBrvNDfMcl4s1YKKEj_IjkC1Sb9RX7zQ', d: 'uZdreBtmZKhj5plteN2V8We6uI8o4hkNbJX_hbcCJUk' },
      format: 'jwk',
    });
    const publicJwk: Ed25519PublicJwk = { kty: 'OKP', crv: 'Ed25519', x: '5vqAF8eRpE9bBrvNDfMcl4s1YKKEj_IjkC1Sb9RX7zQ' };
    const { signatureInput, signature } = signAitRequest({
      method: 'POST', authority: 'merchant.example.com', path: '/checkout', agentIdentity: 'AIT.fixture.token',
      privateKey, publicJwk, created: 1_715_400_000, expires: 1_715_400_060,
    });
    expect(jwkThumbprint(publicJwk)).toBe('mkD85lyXqPsAQ7obXi4KLYtotBqEZP7j0U23VKZc8EI');
    expect(signatureInput).toBe(
      'ait=("@method" "@authority" "@path" "agent-identity");created=1715400000;expires=1715400060;keyid="mkD85lyXqPsAQ7obXi4KLYtotBqEZP7j0U23VKZc8EI";tag="agent-identity"',
    );
    expect(signature).toBe(
      'ait=:1CE7njbRqJUuxYtNcTFjTax1mg+52Rqc633BwdWqBraCur+PUmX8v0VN5y2QiiTl+22rD4f4RkSSINSrVI5pBQ==:',
    );
  });

  it('produces a signature that verifies over the verifier-spec signature base', () => {
    const { privateKey, publicJwk } = makeKey();
    const created = 1_715_400_000;
    const req = { method: 'post', authority: 'Wine.Example:443', path: '/purchase', agentIdentity: ' a.b.c ' };
    const { signatureInput, signature } = signAitRequest({ ...req, privateKey, publicJwk, created });

    // Header shape.
    const keyid = jwkThumbprint(publicJwk);
    expect(signatureInput).toBe(
      `ait=("@method" "@authority" "@path" "agent-identity");created=${created};expires=${created + 60};keyid="${keyid}";tag="agent-identity"`,
    );
    expect(signature).toMatch(/^ait=:[A-Za-z0-9+/]+=*:$/); // standard base64 byte-sequence

    // The signature must verify (Ed25519) over the INDEPENDENTLY rebuilt base — proves byte match.
    const base = expectedBase({ ...req, created, keyid });
    const sigB64 = signature.slice('ait=:'.length, -1);
    const pub = createPublicKey({ key: { ...publicJwk }, format: 'jwk' });
    const ok = nodeVerify(null, Buffer.from(base, 'utf8'), pub, Buffer.from(sigB64, 'base64'));
    expect(ok).toBe(true);
  });

  it('normalizes @authority (lowercase, drops :443) and uppercases @method', () => {
    const { privateKey, publicJwk } = makeKey();
    const created = 1_715_400_001;
    const { signature } = signAitRequest({
      method: 'get', authority: 'API.Example.COM:443', path: '/x', agentIdentity: 'tok',
      privateKey, publicJwk, created,
    });
    const keyid = jwkThumbprint(publicJwk);
    const base = expectedBase({ method: 'get', authority: 'API.Example.COM:443', path: '/x', agentIdentity: 'tok', created, keyid });
    // base must contain the normalized authority + uppercased method
    expect(base).toContain('"@authority": api.example.com');
    expect(base).toContain('"@method": GET');
    const pub = createPublicKey({ key: { ...publicJwk }, format: 'jwk' });
    const ok = nodeVerify(null, Buffer.from(base, 'utf8'), pub, Buffer.from(signature.slice('ait=:'.length, -1), 'base64'));
    expect(ok).toBe(true);
  });

  it('serializes expires in canonical order (created, expires, keyid, tag) and verifies', () => {
    const { privateKey, publicJwk } = makeKey();
    const created = 1_715_400_003;
    const expires = created + 300;
    const req = { method: 'POST', authority: 'wine.example', path: '/purchase', agentIdentity: 'a.b.c' };
    const { signatureInput, signature } = signAitRequest({ ...req, privateKey, publicJwk, created, expires });
    const keyid = jwkThumbprint(publicJwk);
    expect(signatureInput).toBe(
      `ait=("@method" "@authority" "@path" "agent-identity");created=${created};expires=${expires};keyid="${keyid}";tag="agent-identity"`,
    );
    const base = expectedBase({ ...req, created, expires, keyid });
    const pub = createPublicKey({ key: { ...publicJwk }, format: 'jwk' });
    const ok = nodeVerify(null, Buffer.from(base, 'utf8'), pub, Buffer.from(signature.slice('ait=:'.length, -1), 'base64'));
    expect(ok).toBe(true);
  });

  it('normalizes an IPv6 authority (drops :443, keeps the bracketed literal) and verifies', () => {
    const { privateKey, publicJwk } = makeKey();
    const created = 1_715_400_004;
    const req = { method: 'POST', authority: '[2001:DB8::1]:443', path: '/x', agentIdentity: 'tok' };
    const { signature } = signAitRequest({ ...req, privateKey, publicJwk, created });
    const keyid = jwkThumbprint(publicJwk);
    const base = expectedBase({ ...req, created, keyid });
    expect(base).toContain('"@authority": [2001:db8::1]'); // lowercased, :443 dropped, brackets kept
    const pub = createPublicKey({ key: { ...publicJwk }, format: 'jwk' });
    const ok = nodeVerify(null, Buffer.from(base, 'utf8'), pub, Buffer.from(signature.slice('ait=:'.length, -1), 'base64'));
    expect(ok).toBe(true);
  });
});
