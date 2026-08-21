/**
 * pay owns its own spend ceiling through `limits` (per-call, daily,
 * per-merchant), enforced in the onBeforePaymentCreation hook in
 * src/commands/pay.ts.
 *
 * @x402/core 2.23.0 added a SECOND ceiling and turned it on by default: a fresh
 * x402Client carries `spendControls = {}`, and an omitted maxAmountPerPayment
 * falls back to DEFAULT_MAX_AMOUNT_PER_PAYMENT ("$1"). Two ceilings means the
 * lower one wins, and this one loses quietly: it filters the payment
 * requirements out rather than raising pay's structured limit verdict, so an
 * over-$1 payment surfaces as "no acceptable payment requirements" instead of a
 * limit message naming the cap the user actually set.
 *
 * So pay disables it and stays the single authority. The first test is the
 * positive control: it asserts the upstream default is still enforcing, which
 * is what makes the second test meaningful. If upstream ever ships controls off
 * by default, the first test fails and the disable becomes redundant rather
 * than load-bearing.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_MAX_AMOUNT_PER_PAYMENT, x402Client } from '@x402/core/client';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const paySource = readFileSync(join(ROOT, 'src/commands/pay.ts'), 'utf8');

describe('x402 spend controls', () => {
  it('upstream still enables spend controls by default (the reason we disable them)', () => {
    const fresh = new x402Client() as unknown as { spendControls: unknown };
    expect(fresh.spendControls).not.toBe(false);
    expect(DEFAULT_MAX_AMOUNT_PER_PAYMENT).toBe('$1');
  });

  it('disabling actually turns them off', () => {
    const disabled = new x402Client().setSpendControls(false) as unknown as {
      spendControls: unknown;
    };
    expect(disabled.spendControls).toBe(false);
  });

  it('pay disables them so `limits` remains the only spend ceiling', () => {
    expect(paySource).toContain('setSpendControls(false)');
  });
});
