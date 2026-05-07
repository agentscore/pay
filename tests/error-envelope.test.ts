/**
 * End-to-end and unit assertions on the JSON wire shape of error responses.
 *
 * Locks in the contract: when a CliError is raised with a `nextSteps` block
 * and an `extra` payload, both reach the wire envelope agents consume, in
 * every output format incur supports, with exit codes and metadata
 * preserved. Implemented via the `serveCli` wrapper in src/cli.ts.
 *
 * Test groups:
 *   1. Compact-format error envelopes — extras + next_steps surface in JSON,
 *      TOON, YAML, MD, JSONL.
 *   2. Full-output (envelope-wrapped) errors — JSON parse/swap preserves
 *      incur's meta.command + meta.duration; non-JSON full-output falls back
 *      to a synthesized envelope.
 *   3. Format precedence — `--json` and `--format <fmt>` are last-wins,
 *      matching incur's argv loop.
 *   4. Passthrough paths — non-CliError errors (COMMAND_NOT_FOUND, --help,
 *      --version) flow through incur unchanged.
 *   5. Triggerable error catalog — every CliError site we can fire without
 *      external deps gets at least one assertion that its `extra` /
 *      `nextSteps` reach the wire.
 *   6. Pure-function unit tests — `exitCodeForError` and `isRetryable`.
 *   7. Wrap-internal correctness — empty extras, success passthrough,
 *      pendingError leak prevention.
 */

import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli, isRetryable, RETRYABLE_CODES, serveCli } from '../src/cli';
import { EXIT_CODES, exitCodeForError, type ErrorCode } from '../src/errors';

const ROOT = '/tmp/pay-error-envelope-test';

interface JsonError {
  code?: string;
  message?: string;
  retryable?: boolean;
  extra?: Record<string, unknown>;
  next_steps?: { action?: string; suggestion?: string };
  [k: string]: unknown;
}

interface RunResult {
  stdout: string;
  exitCode: number | undefined;
}

async function run(...argv: string[]): Promise<RunResult> {
  let stdout = '';
  let exitCode: number | undefined;
  await serveCli(buildCli(), {
    argv,
    stdout: (s) => {
      stdout += s;
    },
    exit: (code) => {
      exitCode = code;
    },
  });
  return { stdout, exitCode };
}

async function runJson(...argv: string[]): Promise<{ json: JsonError; exitCode: number | undefined }> {
  const { stdout, exitCode } = await run(...argv, '--format', 'json');
  return { json: JSON.parse(stdout) as JsonError, exitCode };
}

beforeEach(async () => {
  process.env.HOME = ROOT;
  delete process.env.AGENTSCORE_API_KEY;
  delete process.env.AGENTSCORE_PAY_PASSPHRASE;
  await rm(ROOT, { recursive: true, force: true });
  await mkdir(join(ROOT, '.agentscore'), { recursive: true });
});

afterEach(async () => {
  delete process.env.HOME;
  await rm(ROOT, { recursive: true, force: true });
});

// ───────────────────────────────────────────────────────────────────────────
// 1. Compact-format error envelopes
// ───────────────────────────────────────────────────────────────────────────

describe('compact error envelope — JSON', () => {
  it('surfaces code + message + retryable as the floor contract', async () => {
    const { json, exitCode } = await runJson('config', 'set', 'bad_key', 'x');
    expect(exitCode).toBe(1);
    expect(json.code).toBe('config_error');
    expect(json.message).toMatch(/bad_key/);
    expect(json.retryable).toBe(false);
  });

  it('surfaces extra.valid_keys for unknown config key on set', async () => {
    const { json } = await runJson('config', 'set', 'bad_key', 'x');
    expect(json.extra?.valid_keys).toEqual(expect.arrayContaining(['preferred_chains']));
  });

  it('surfaces extra.valid_keys for unknown config key on get', async () => {
    const { json } = await runJson('config', 'get', 'bad_key');
    expect(json.code).toBe('config_error');
    expect(json.extra?.valid_keys).toEqual(expect.arrayContaining(['preferred_chains']));
  });

  it('surfaces extra.valid_keys for unknown config key on unset', async () => {
    const { json } = await runJson('config', 'unset', 'bad_key');
    expect(json.code).toBe('config_error');
    expect(json.extra?.valid_keys).toEqual(expect.arrayContaining(['preferred_chains']));
  });

  it('surfaces extra.valid_chains when preferred_chains contains an unknown chain', async () => {
    const { json } = await runJson('config', 'set', 'preferred_chains', 'unknownchain');
    expect(json.code).toBe('config_error');
    expect(json.extra?.valid_chains).toEqual(expect.arrayContaining(['base', 'solana', 'tempo']));
  });

  it('surfaces extra.chain + extra.name on no_wallet from wallet remove', async () => {
    const { json, exitCode } = await runJson(
      'wallet',
      'remove',
      '--chain',
      'base',
      '--name',
      'nonexistent',
      '--danger',
      '--skip-confirm',
    );
    expect(exitCode).toBe(1);
    expect(json.code).toBe('no_wallet');
    expect(json.extra?.chain).toBe('base');
    expect(json.extra?.name).toBe('nonexistent');
  });

  it('surfaces next_steps.action + next_steps.suggestion on invalid_key (mnemonic)', async () => {
    const { json, exitCode } = await runJson(
      'wallet',
      'import',
      '--mnemonic',
      'not a real bip39 phrase abc def',
      '--chain',
      'base',
    );
    expect(exitCode).toBe(1);
    expect(json.code).toBe('invalid_key');
    expect(json.next_steps?.action).toBe('check_phrase');
    expect(json.next_steps?.suggestion).toMatch(/BIP-39/);
  });

  it('surfaces both extra and next_steps when both are present (no_wallet via selection)', async () => {
    // pay command goes through selection.ts which throws no_wallet with both extra and nextSteps.
    const { json, exitCode } = await runJson(
      'pay',
      'POST',
      'https://example.invalid/x',
      '--max-spend',
      '5',
    );
    expect(exitCode).toBe(1);
    expect(json.code).toBe('no_wallet');
    expect(json.extra).toBeDefined();
    expect(json.extra?.wallet_name).toBe('default');
    expect(json.next_steps?.action).toBe('create_wallet');
    expect(json.next_steps?.suggestion).toMatch(/wallet create/);
  });

  it('omits extra and next_steps fields when CliError has neither', async () => {
    // unlock --for with bad format → invalid_input, no extras, no nextSteps
    const { json, exitCode } = await runJson('unlock', '--for', 'bad-format');
    expect(exitCode).toBe(1);
    expect(json.code).toBe('invalid_input');
    expect(json.extra).toBeUndefined();
    expect(json.next_steps).toBeUndefined();
  });

  it('handles CliError with no nextSteps + no extra (passphrase_too_short via env)', async () => {
    // wallet create with too-short passphrase env
    process.env.AGENTSCORE_PAY_PASSPHRASE = 'short';
    const { json, exitCode } = await runJson(
      'wallet',
      'create',
      '--chain',
      'base',
      '--no-mnemonic',
    );
    delete process.env.AGENTSCORE_PAY_PASSPHRASE;
    expect(exitCode).toBe(1);
    expect(json.code).toBe('passphrase_too_short');
    expect(json.extra).toBeUndefined();
    expect(json.next_steps).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Compact error envelope — non-JSON formats (TOON, YAML, MD, JSONL)
// ───────────────────────────────────────────────────────────────────────────

describe('compact error envelope — non-JSON formats', () => {
  it('TOON renders extras as a nested block', async () => {
    const { stdout, exitCode } = await run('config', 'set', 'bad_key', 'x', '--format', 'toon');
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/code:\s*config_error/);
    expect(stdout).toMatch(/message:\s*"?Unknown config key/);
    expect(stdout).toMatch(/retryable:\s*false/);
    expect(stdout).toMatch(/extra:\s*\n\s*valid_keys/);
  });

  it('YAML renders extras with double-quoted strings', async () => {
    const { stdout, exitCode } = await run('config', 'set', 'bad_key', 'x', '--format', 'yaml');
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/code:\s*config_error/);
    expect(stdout).toMatch(/message:\s*"Unknown config key: bad_key"/);
    expect(stdout).toMatch(/extra:\s*\n\s*valid_keys/);
  });

  it('Markdown renders extras as a nested key block', async () => {
    const { stdout, exitCode } = await run('config', 'set', 'bad_key', 'x', '--format', 'md');
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/code/);
    expect(stdout).toMatch(/config_error/);
    expect(stdout).toMatch(/valid_keys/);
  });

  it('JSONL renders the error as a single JSON line', async () => {
    const { stdout, exitCode } = await run('config', 'set', 'bad_key', 'x', '--format', 'jsonl');
    expect(exitCode).toBe(1);
    const trimmed = stdout.trim();
    expect(trimmed.split('\n')).toHaveLength(1);
    const parsed = JSON.parse(trimmed) as JsonError;
    expect(parsed.code).toBe('config_error');
    expect(parsed.extra?.valid_keys).toEqual(expect.arrayContaining(['preferred_chains']));
  });

  it('next_steps surface in TOON for invalid_key', async () => {
    const { stdout, exitCode } = await run(
      'wallet',
      'import',
      '--mnemonic',
      'not a real phrase',
      '--chain',
      'base',
      '--format',
      'toon',
    );
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/code:\s*invalid_key/);
    expect(stdout).toMatch(/next_steps:/);
    expect(stdout).toMatch(/action:\s*check_phrase/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Full-output (envelope-wrapped) errors
// ───────────────────────────────────────────────────────────────────────────

describe('full-output error envelope', () => {
  it('JSON full-output preserves incur meta.command + meta.duration', async () => {
    const { stdout, exitCode } = await run(
      'wallet',
      'remove',
      '--chain',
      'base',
      '--name',
      'nonexistent',
      '--danger',
      '--skip-confirm',
      '--format',
      'json',
      '--full-output',
    );
    expect(exitCode).toBe(1);
    const wrapped = JSON.parse(stdout) as {
      ok: boolean;
      error: JsonError;
      meta?: { command?: string; duration?: string };
    };
    expect(wrapped.ok).toBe(false);
    expect(wrapped.error.code).toBe('no_wallet');
    expect(wrapped.error.extra?.chain).toBe('base');
    expect(wrapped.meta?.command).toBe('wallet remove');
    expect(wrapped.meta?.duration).toMatch(/^\d+ms$/);
  });

  it('JSON full-output keeps the ok: false flag', async () => {
    const { stdout } = await run(
      'config',
      'set',
      'bad_key',
      'x',
      '--format',
      'json',
      '--full-output',
    );
    const wrapped = JSON.parse(stdout) as { ok: boolean; error: JsonError };
    expect(wrapped.ok).toBe(false);
    expect(wrapped.error.extra?.valid_keys).toBeDefined();
  });

  it('YAML full-output renders ok / error / extra hierarchy (no parser → synthesized envelope)', async () => {
    const { stdout, exitCode } = await run(
      'config',
      'set',
      'bad_key',
      'x',
      '--format',
      'yaml',
      '--full-output',
    );
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/ok:\s*false/);
    expect(stdout).toMatch(/error:/);
    expect(stdout).toMatch(/extra:/);
    expect(stdout).toMatch(/valid_keys:/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. Format precedence
// ───────────────────────────────────────────────────────────────────────────

describe('format precedence — last-wins', () => {
  it('--json then --format yaml → YAML wins', async () => {
    const { stdout } = await run('config', 'set', 'bad_key', 'x', '--json', '--format', 'yaml');
    expect(stdout.trimStart().startsWith('{')).toBe(false);
    expect(stdout).toMatch(/code:\s*config_error/);
  });

  it('--format yaml then --json → JSON wins', async () => {
    const { stdout } = await run('config', 'set', 'bad_key', 'x', '--format', 'yaml', '--json');
    expect(stdout.trimStart().startsWith('{')).toBe(true);
    const json = JSON.parse(stdout) as JsonError;
    expect(json.code).toBe('config_error');
  });

  it('default (no flag) is TOON', async () => {
    const { stdout } = await run('config', 'set', 'bad_key', 'x');
    expect(stdout.trimStart().startsWith('{')).toBe(false);
    expect(stdout).toMatch(/code:\s*config_error/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Non-CliError passthrough — incur's own envelopes flow through unchanged
// ───────────────────────────────────────────────────────────────────────────

describe('non-CliError passthrough', () => {
  it('COMMAND_NOT_FOUND emits incur envelope with cta intact (no enrichment)', async () => {
    const { json, exitCode } = await runJson('doesnotexist');
    expect(exitCode).toBe(1);
    expect(json.code).toBe('COMMAND_NOT_FOUND');
    expect(json.message).toMatch(/doesnotexist/);
    // Our wrap should NOT inject `extra` or `next_steps` because no CliError
    // fired — pendingError stays null.
    expect(json.extra).toBeUndefined();
    expect(json.next_steps).toBeUndefined();
    // `cta` is incur's CTA block, preserved via verbatim chunk replay.
    expect((json as Record<string, unknown>).cta).toBeDefined();
  });

  it('--version prints version string verbatim', async () => {
    const { stdout, exitCode } = await run('--version');
    expect(exitCode).toBeUndefined(); // success path; incur does not call exit
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('--help renders help output without our envelope', async () => {
    const { stdout, exitCode } = await run('--help');
    expect(exitCode).toBeUndefined();
    expect(stdout).toMatch(/agentscore-pay/);
    expect(stdout).toMatch(/Commands/);
  });

  it('--llms emits the LLM manifest', async () => {
    const { stdout, exitCode } = await run('--llms');
    expect(exitCode).toBeUndefined();
    expect(stdout.length).toBeGreaterThan(100);
    expect(stdout).toMatch(/agentscore-pay/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 6. Pure-function unit tests — exit code mapping and retryable predicate
// ───────────────────────────────────────────────────────────────────────────

describe('exitCodeForError mapping', () => {
  const cases: Array<[ErrorCode, number]> = [
    ['network_error', EXIT_CODES.NETWORK_ERROR],
    ['rpc_error', EXIT_CODES.NETWORK_ERROR],
    ['merchant_error', EXIT_CODES.NETWORK_ERROR],
    ['session_timeout', EXIT_CODES.NETWORK_ERROR],
    ['passport_api_error', EXIT_CODES.NETWORK_ERROR],
    ['passport_verification_timeout', EXIT_CODES.NETWORK_ERROR],
    ['merchant_spec_violation', EXIT_CODES.PAYMENT_REJECTED],
    ['max_spend_exceeded', EXIT_CODES.PAYMENT_REJECTED],
    ['limit_exceeded', EXIT_CODES.PAYMENT_REJECTED],
    ['insufficient_balance', EXIT_CODES.INSUFFICIENT_FUNDS],
    ['no_funded_rail', EXIT_CODES.INSUFFICIENT_FUNDS],
    ['multi_rail_candidates', EXIT_CODES.MULTI_RAIL_AMBIGUITY],
    ['no_wallet', EXIT_CODES.USER_ERROR],
    ['wallet_exists', EXIT_CODES.USER_ERROR],
    ['wrong_passphrase', EXIT_CODES.USER_ERROR],
    ['passphrase_too_short', EXIT_CODES.USER_ERROR],
    ['passphrase_mismatch', EXIT_CODES.USER_ERROR],
    ['unsupported_rail', EXIT_CODES.USER_ERROR],
    ['unknown_chain', EXIT_CODES.USER_ERROR],
    ['invalid_key', EXIT_CODES.USER_ERROR],
    ['invalid_input', EXIT_CODES.USER_ERROR],
    ['user_cancelled', EXIT_CODES.USER_ERROR],
    ['config_error', EXIT_CODES.USER_ERROR],
    ['quota_exceeded', EXIT_CODES.USER_ERROR],
    ['passport_verification_failed', EXIT_CODES.USER_ERROR],
    ['passport_token_expired', EXIT_CODES.USER_ERROR],
    ['unknown', EXIT_CODES.USER_ERROR],
  ];

  it.each(cases)('%s → exit code %d', (code, expected) => {
    expect(exitCodeForError(code)).toBe(expected);
  });
});

describe('isRetryable predicate', () => {
  it('returns true for the canonical retryable codes', () => {
    expect(isRetryable('network_error')).toBe(true);
    expect(isRetryable('rpc_error')).toBe(true);
    expect(isRetryable('session_timeout')).toBe(true);
  });

  it('returns false for non-retryable codes', () => {
    for (const code of [
      'no_wallet',
      'invalid_input',
      'config_error',
      'invalid_key',
      'multi_rail_candidates',
      'insufficient_balance',
      'merchant_spec_violation',
      'passport_token_expired',
      'unknown',
    ]) {
      expect(isRetryable(code)).toBe(false);
    }
  });

  it('RETRYABLE_CODES set matches the predicate', () => {
    const codes = ['network_error', 'rpc_error', 'session_timeout', 'config_error'];
    for (const code of codes) {
      expect(RETRYABLE_CODES.has(code)).toBe(isRetryable(code));
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 7. Wrap-internal correctness — success passthrough, leak prevention
// ───────────────────────────────────────────────────────────────────────────

describe('sync throw in non-async withCliErrors arrow', () => {
  // Regression: fund-estimate uses `withCliErrors(() => fundEstimate({headers: parseHeaders(...)}))`
  // where parseHeaders is sync. A sync throw during arg construction must
  // still surface as `code: invalid_input` (not the UNKNOWN fallback that
  // `fn().catch` would leak through for non-async arrows).
  it('fund-estimate with malformed -H surfaces invalid_input + extras through the wrap', async () => {
    const { json, exitCode } = await runJson(
      'fund-estimate',
      'https://example.invalid',
      '-X',
      'POST',
      '-H',
      'BadHeaderNoColon',
    );
    expect(exitCode).toBe(1);
    expect(json.code).toBe('invalid_input');
    expect(json.message).toMatch(/Invalid -H header/);
    // Critically: NOT 'UNKNOWN'.
    expect(json.code).not.toBe('UNKNOWN');
  });

  it('check with malformed -H also surfaces invalid_input (async arrow path, sanity)', async () => {
    const { json, exitCode } = await runJson(
      'check',
      'https://example.invalid',
      '-H',
      'AnotherBad',
    );
    expect(exitCode).toBe(1);
    expect(json.code).toBe('invalid_input');
    expect(json.message).toMatch(/Invalid -H header/);
  });
});

describe('token-flag passthrough', () => {
  it('--token-count on a CliError emits incur token count, not the enriched envelope', async () => {
    const { stdout, exitCode } = await run(
      'config',
      'set',
      'bad_key',
      'x',
      '--json',
      '--token-count',
    );
    expect(exitCode).toBe(1);
    // `--token-count` makes incur emit just the integer token count of the formatted error.
    // Our wrap must NOT replace it with an envelope.
    expect(stdout.trim()).toMatch(/^\d+$/);
    expect(stdout).not.toMatch(/"code"/);
  });

  it('--token-limit on a CliError respects incur truncation', async () => {
    const { stdout, exitCode } = await run(
      'config',
      'set',
      'bad_key',
      'x',
      '--json',
      '--token-limit',
      '5',
    );
    expect(exitCode).toBe(1);
    // Incur's truncate footer should appear.
    expect(stdout).toMatch(/\[truncated:/);
  });

  it('--token-offset on a CliError respects incur pagination', async () => {
    const { stdout, exitCode } = await run(
      'config',
      'set',
      'bad_key',
      'x',
      '--json',
      '--token-offset',
      '10',
      '--token-limit',
      '5',
    );
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/\[truncated:/);
  });
});

describe('human-TTY passthrough', () => {
  it('TTY + no flag: passes incur formatHumanError verbatim (no enrichment)', async () => {
    const originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
    });
    try {
      let stdout = '';
      let exitCode: number | undefined;
      await serveCli(buildCli(), {
        argv: ['config', 'set', 'bad_key', 'x'],
        stdout: (s) => {
          stdout += s;
        },
        exit: (code) => {
          exitCode = code;
        },
      });
      expect(exitCode).toBe(1);
      // formatHumanError shape: "Error (code): message" — single line, friendly
      expect(stdout).toMatch(/^Error \(config_error\): Unknown config key: bad_key/);
      // Multi-line TOON / structured extras should NOT appear in human-TTY output
      expect(stdout).not.toMatch(/^extra:/m);
      expect(stdout).not.toMatch(/^retryable:/m);
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: originalIsTTY,
        configurable: true,
      });
    }
  });

  it('TTY + --json: enriches anyway (explicit format wins over TTY default)', async () => {
    const originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
    });
    try {
      let stdout = '';
      await serveCli(buildCli(), {
        argv: ['config', 'set', 'bad_key', 'x', '--json'],
        stdout: (s) => {
          stdout += s;
        },
        exit: () => {},
      });
      const json = JSON.parse(stdout) as JsonError;
      expect(json.code).toBe('config_error');
      expect(json.extra?.valid_keys).toBeDefined();
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: originalIsTTY,
        configurable: true,
      });
    }
  });

  it('non-TTY + no flag: enriches (pipe / agent / script context default)', async () => {
    // Vitest workers run with stdout.isTTY === false, so this is the
    // ambient case for the rest of the test suite. Asserting it explicitly
    // here documents the contract.
    expect(process.stdout.isTTY).not.toBe(true);
    const { stdout } = await run('config', 'set', 'bad_key', 'x');
    expect(stdout).toMatch(/code:\s*config_error/);
    expect(stdout).toMatch(/extra:/);
    expect(stdout).toMatch(/valid_keys/);
  });
});

describe('wrap-internal correctness', () => {
  it('success path passes through verbatim, no enrichment', async () => {
    const { json, exitCode } = await runJson('config', 'get');
    expect(exitCode).toBeUndefined();
    expect(json.code).toBeUndefined();
    expect(json.message).toBeUndefined();
    expect((json as Record<string, unknown>).path).toEqual(expect.any(String));
    expect((json as Record<string, unknown>).valid_keys).toEqual(
      expect.arrayContaining(['preferred_chains']),
    );
  });

  it('full-output success passes through with incur envelope intact', async () => {
    const { stdout, exitCode } = await run('config', 'get', '--format', 'json', '--full-output');
    expect(exitCode).toBeUndefined();
    const wrapped = JSON.parse(stdout) as {
      ok: boolean;
      data: { path: string; valid_keys: string[] };
      meta: { command: string; duration: string };
    };
    expect(wrapped.ok).toBe(true);
    expect(wrapped.data.path).toBeDefined();
    expect(wrapped.data.valid_keys).toEqual(expect.arrayContaining(['preferred_chains']));
    expect(wrapped.meta.command).toBe('config get');
    expect(wrapped.meta.duration).toMatch(/^\d+ms$/);
  });

  it('pendingError does not leak between sequential serveCli calls', async () => {
    // First: trigger a CliError (sets pendingError before the final drain)
    const first = await runJson('config', 'set', 'bad_key', 'x');
    expect(first.json.code).toBe('config_error');
    // Second: success path — must NOT emit an enriched error envelope
    const second = await runJson('config', 'get');
    expect(second.exitCode).toBeUndefined();
    expect(second.json.code).toBeUndefined();
    expect((second.json as Record<string, unknown>).path).toBeDefined();
  });

  it('exit code 1 is set whenever a CliError fires through the wrap', async () => {
    for (const args of [
      ['config', 'set', 'bad_key', 'x'],
      ['config', 'get', 'bad_key'],
      ['config', 'unset', 'bad_key'],
      ['wallet', 'remove', '--chain', 'base', '--name', 'X', '--danger', '--skip-confirm'],
      ['unlock', '--for', 'bad-format'],
    ]) {
      const { exitCode } = await runJson(...args);
      expect(exitCode, `args=${args.join(' ')}`).toBe(1);
    }
  });
});
