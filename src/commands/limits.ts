import { CliError } from '../errors';
import { clearLimits, limitsPath, loadLimits, saveLimits, type Limits } from '../limits';
import { isJson, writeJson, writeLine } from '../output';

export interface LimitsSetOptions {
  daily?: number;
  perCall?: number;
  perMerchant?: number;
}

export async function limitsShow(): Promise<void> {
  const limits = await loadLimits();
  if (isJson()) {
    writeJson({ path: limitsPath(), limits });
    return;
  }
  writeLine(`Limits file: ${limitsPath()}`);
  if (!limits.per_call_usd && !limits.daily_usd && !limits.per_merchant_usd) {
    writeLine('No limits set.');
    return;
  }
  if (limits.per_call_usd !== undefined) writeLine(`  per-call:     $${limits.per_call_usd}`);
  if (limits.daily_usd !== undefined) writeLine(`  daily:        $${limits.daily_usd}`);
  if (limits.per_merchant_usd !== undefined) writeLine(`  per-merchant: $${limits.per_merchant_usd}`);
}

export async function limitsSet(opts: LimitsSetOptions): Promise<void> {
  const anySet = opts.daily !== undefined || opts.perCall !== undefined || opts.perMerchant !== undefined;
  if (!anySet) {
    throw new CliError('invalid_input', 'Pass at least one of --daily, --per-call, --per-merchant.', {
      nextSteps: { action: 'supply_flag', suggestion: 'Example: limits set --daily 50 --per-call 5' },
    });
  }
  const current = await loadLimits();
  const next: Limits = { ...current };
  if (opts.daily !== undefined) next.daily_usd = opts.daily;
  if (opts.perCall !== undefined) next.per_call_usd = opts.perCall;
  if (opts.perMerchant !== undefined) next.per_merchant_usd = opts.perMerchant;
  await saveLimits(next);
  if (isJson()) {
    writeJson({ path: limitsPath(), limits: next });
    return;
  }
  writeLine('Limits saved:');
  await limitsShow();
}

export async function limitsClear(): Promise<void> {
  await clearLimits();
  if (isJson()) {
    writeJson({ cleared: true, path: limitsPath() });
    return;
  }
  writeLine('Limits cleared.');
}
