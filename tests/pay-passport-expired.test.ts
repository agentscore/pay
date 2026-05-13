import { describe, expect, it, vi } from 'vitest';
import { pay } from '../src/commands/pay';

vi.mock('../src/selection', () => ({
  selectRail: vi.fn().mockResolvedValue({
    chain: 'base',
    address: '0x1234567890123456789012345678901234567890',
    balance_usdc: '5.000000',
  }),
}));

vi.mock('../src/passport/attach', () => ({
  attachPassport: vi.fn().mockResolvedValue({
    kind: 'expired',
    passport: {
      version: 1,
      operator_token: 'opc_expiredtoken_abc123',
      expires_at: Date.now() - 1000,
      saved_at: Date.now() - 24 * 60 * 60 * 1000,
    },
  }),
}));

vi.mock('../src/passport/bootstrap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/passport/bootstrap')>();
  return {
    ...actual,
    // Throw fast on TTY-path so the bootstrap-driven test doesn't poll for an hour.
    bootstrapFromExpiry: vi.fn().mockRejectedValue(
      Object.assign(new Error('mock bootstrap unavailable'), { code: 'mock_bootstrap_blocked' }),
    ),
  };
});

// Note: the symmetric merchant-403 cold-start path (passport_required_by_merchant)
// applies the exact same `!process.stdout.isTTY` check immediately before
// `bootstrapFromMerchantSession`. Unit-testing it requires mocking the entire
// x402/MPP request flow (rail-specific clients wrapping fetch) to return a 403
// with bootstrap fields, which is heavier than the path's structure warrants.
// The structural symmetry with the expired-access tests below + live smoke against
// a real merchant integration covers the contract.

function withTTY(value: boolean, fn: () => Promise<void>): Promise<void> {
  const origDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true });
  return fn().finally(() => {
    if (origDescriptor) {
      Object.defineProperty(process.stdout, 'isTTY', origDescriptor);
    } else {
      delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
  });
}

describe('pay — expired passport on non-TTY', () => {
  it('throws passport_login_required with action=passport_login when stdout is not a TTY', async () => {
    await withTTY(false, async () => {
      await expect(
        pay({ method: 'POST', url: 'https://m.example/x', maxSpendUsd: 5 }),
      ).rejects.toMatchObject({
        code: 'passport_login_required',
        nextSteps: { action: 'passport_login' },
      });
    });
  });

  it('exposes the previous token prefix in extra so the agent can identify which passport was rejected', async () => {
    await withTTY(false, async () => {
      try {
        await pay({ method: 'POST', url: 'https://m.example/x', maxSpendUsd: 5 });
        throw new Error('expected pay() to throw');
      } catch (err) {
        expect(err).toMatchObject({
          code: 'passport_login_required',
          extra: { previous_token_prefix: 'opc_expi…' },
        });
      }
    });
  });

  it('skips the structured throw and drives inline bootstrap when stdout IS a TTY', async () => {
    // On TTY, pay should NOT throw passport_login_required — it falls through to
    // bootstrapFromExpiry. That call ultimately fails in the test environment (no
    // real /v1/sessions/public), so the resulting error code is anything BUT
    // passport_login_required — proving the TTY branch took the bootstrap path.
    await withTTY(true, async () => {
      const result = await pay({ method: 'POST', url: 'https://m.example/x', maxSpendUsd: 5 })
        .then(() => ({ ok: true, code: undefined as string | undefined }))
        .catch((err: { code?: string }) => ({ ok: false, code: err.code }));
      expect(result.code).not.toBe('passport_login_required');
    });
  });

  it('skips the structured throw on dry-run regardless of TTY (dry-run leaves kind: expired visible)', async () => {
    await withTTY(false, async () => {
      const result = await pay({
        method: 'POST',
        url: 'https://m.example/x',
        maxSpendUsd: 5,
        dryRun: true,
      });
      expect(result).toMatchObject({ dry_run: true });
    });
  });
});
