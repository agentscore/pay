/**
 * `--identity operator` semantics: an explicit choice of the operator_token model must fail fast
 * when no credential exists — never silently downgrade to the X-Wallet-Address header (a different
 * identity model with different compliance outcomes).
 */
import { describe, expect, it, vi } from 'vitest';
import { pay } from '../src/commands/pay';

vi.mock('../src/selection', () => ({
  selectRail: vi.fn().mockResolvedValue({
    chain: 'base',
    address: '0x1234567890123456789012345678901234567890',
    balance_usdc: '5.000000',
  }),
}));

// No stored Passport (absent), unless the caller supplies their own token (opted_out — caller wins).
vi.mock('../src/passport/attach', () => ({
  attachPassport: vi.fn(async (input: { callerSuppliedOperatorToken?: string; skipPassport?: boolean } = {}) => {
    if (input.skipPassport || input.callerSuppliedOperatorToken) return { kind: 'opted_out' };
    return { kind: 'absent' };
  }),
}));

const CALLER_TOKEN = `opc_${'c'.repeat(40)}`;

describe('pay --identity operator — no stored credential', () => {
  it('fails fast instead of falling back to the wallet header (live path)', async () => {
    await expect(
      pay({ method: 'POST', url: 'https://merchant.example/api', identity: 'operator', maxSpendUsd: 5 }),
    ).rejects.toMatchObject({
      code: 'passport_login_required',
      message: expect.stringContaining('refusing to fall back to wallet identity'),
      nextSteps: { action: 'passport_login' },
    });
  });

  it('fails fast on dry-run too (the plan never previews a wallet-identity downgrade)', async () => {
    await expect(
      pay({ method: 'POST', url: 'https://merchant.example/api', identity: 'operator', maxSpendUsd: 5, dryRun: true }),
    ).rejects.toMatchObject({ code: 'passport_login_required' });
  });

  it('accepts a caller-supplied X-Operator-Token (explicit credential, no fallback involved)', async () => {
    const result = await pay({
      method: 'POST',
      url: 'https://merchant.example/api',
      identity: 'operator',
      maxSpendUsd: 5,
      dryRun: true,
      headers: { 'X-Operator-Token': CALLER_TOKEN },
    });
    expect(result).toMatchObject({
      dry_run: true,
      identity: { mode: 'operator', method: 'caller_supplied' },
      headers: expect.objectContaining({ 'X-Operator-Token': CALLER_TOKEN }),
    });
    expect((result as { headers: Record<string, string> }).headers).not.toHaveProperty('X-Wallet-Address');
  });
});
