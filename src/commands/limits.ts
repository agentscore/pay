import { CliError } from '../errors';
import { clearLimits, limitsPath, loadLimits, saveLimits, type Limits } from '../limits';

export interface LimitsSetInput {
  daily?: number;
  perCall?: number;
  perMerchant?: number;
}

export async function limitsShow(): Promise<{ path: string; limits: Limits }> {
  const limits = await loadLimits();
  return { path: limitsPath(), limits };
}

export async function limitsSet(input: LimitsSetInput): Promise<{ path: string; limits: Limits }> {
  const anySet = input.daily !== undefined || input.perCall !== undefined || input.perMerchant !== undefined;
  if (!anySet) {
    throw new CliError('invalid_input', 'Pass at least one of --daily, --per-call, --per-merchant.', {
      nextSteps: { action: 'supply_flag', suggestion: 'Example: limits set --daily 50 --per-call 5' },
    });
  }
  const current = await loadLimits();
  const next: Limits = { ...current };
  if (input.daily !== undefined) next.daily_usd = input.daily;
  if (input.perCall !== undefined) next.per_call_usd = input.perCall;
  if (input.perMerchant !== undefined) next.per_merchant_usd = input.perMerchant;
  await saveLimits(next);
  return { path: limitsPath(), limits: next };
}

export async function limitsClear(): Promise<{ cleared: true; path: string }> {
  await clearLimits();
  return { cleared: true, path: limitsPath() };
}
