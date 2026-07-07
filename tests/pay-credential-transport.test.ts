import { describe, expect, it, vi } from 'vitest';
import { pay } from '../src/commands/pay';

// A funded Base wallet so rail selection succeeds; the credential-transport
// guard runs before any wallet/passphrase work, so these never reach signing.
vi.mock('../src/selection', () => ({
  selectRail: vi.fn().mockResolvedValue({
    chain: 'base',
    address: '0x1234567890123456789012345678901234567890',
    balance_usdc: '5.000000',
  }),
}));

// A valid (attached) stored Passport — so pay() WANTS to attach X-Operator-Token,
// which is exactly the path the https-target guard protects. Honors skipPassport
// (→ opted_out) so the no-credential path is exercised faithfully.
vi.mock('../src/passport/attach', () => ({
  attachPassport: vi.fn(async (input: { skipPassport?: boolean } = {}) => {
    if (input.skipPassport) return { kind: 'opted_out' };
    return {
      kind: 'attached',
      operatorToken: 'opc_durable_secret_xyz',
      passport: {
        version: 1,
        operator_token: 'opc_durable_secret_xyz',
        expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
        saved_at: Date.now(),
      },
      expiringSoon: false,
    };
  }),
}));

describe('pay — credential-transport guard (operator_token path)', () => {
  it('REFUSES an http:// merchant when the Passport would be attached (live path, before any signing)', async () => {
    await expect(
      pay({ method: 'POST', url: 'http://merchant.example/api', maxSpendUsd: 5 }),
    ).rejects.toMatchObject({ code: 'insecure_credential_transport' });
  });

  it('REFUSES an http:// merchant on dry-run too (plan never previews the secret on cleartext)', async () => {
    await expect(
      pay({ method: 'POST', url: 'http://merchant.example/api', maxSpendUsd: 5, dryRun: true }),
    ).rejects.toMatchObject({ code: 'insecure_credential_transport' });
  });

  it('allows https:// — the plan carries X-Operator-Token (guard passes the same-host secure settle)', async () => {
    const result = await pay({
      method: 'POST',
      url: 'https://merchant.example/api',
      maxSpendUsd: 5,
      dryRun: true,
    });
    expect(result).toMatchObject({
      dry_run: true,
      identity: { method: 'operator_token' },
      headers: expect.objectContaining({ 'X-Operator-Token': 'opc_durable_secret_xyz' }),
    });
  });

  it('allows http:// when --skip-passport (no credential attached → no guard) — wallet identity instead', async () => {
    const result = await pay({
      method: 'POST',
      url: 'http://merchant.example/api',
      maxSpendUsd: 5,
      dryRun: true,
      skipPassport: true,
    });
    expect(result).toMatchObject({ dry_run: true, identity: { method: 'wallet' } });
    expect((result as { headers: Record<string, string> }).headers).not.toHaveProperty(
      'X-Operator-Token',
    );
  });

  it('allows http://localhost (dev carve-out) with the Passport attached', async () => {
    const result = await pay({
      method: 'POST',
      url: 'http://localhost:3000/api',
      maxSpendUsd: 5,
      dryRun: true,
    });
    expect(result).toMatchObject({
      dry_run: true,
      headers: expect.objectContaining({ 'X-Operator-Token': 'opc_durable_secret_xyz' }),
    });
  });
});
