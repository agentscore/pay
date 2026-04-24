import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CliError } from '../src/errors';
import { getMode, resolveMode, setMode, writeError, writeJson, writeLine } from '../src/output';

describe('output', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setMode('human');
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  describe('resolveMode', () => {
    it('returns json when --json flag is set', () => {
      expect(resolveMode({ json: true })).toBe('json');
    });

    it('returns plain when --plain flag is set', () => {
      expect(resolveMode({ plain: true })).toBe('plain');
    });

    it('returns plain when not a TTY', () => {
      const original = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      expect(resolveMode({})).toBe('plain');
      Object.defineProperty(process.stdout, 'isTTY', { value: original, configurable: true });
    });

    it('returns human when TTY and no flags', () => {
      const original = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      expect(resolveMode({})).toBe('human');
      Object.defineProperty(process.stdout, 'isTTY', { value: original, configurable: true });
    });
  });

  describe('writeJson / writeLine', () => {
    it('writeJson always emits JSON on stdout with newline', () => {
      setMode('human');
      writeJson({ a: 1 });
      expect(stdoutSpy).toHaveBeenCalledWith('{"a":1}\n');
    });

    it('writeLine suppresses output in json mode', () => {
      setMode('json');
      writeLine('hello');
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('writeLine emits in human mode', () => {
      setMode('human');
      writeLine('hello');
      expect(stdoutSpy).toHaveBeenCalledWith('hello\n');
    });

    it('getMode reflects setMode', () => {
      setMode('json');
      expect(getMode()).toBe('json');
      setMode('plain');
      expect(getMode()).toBe('plain');
    });
  });

  describe('writeError', () => {
    it('emits structured JSON on stderr in json mode', () => {
      setMode('json');
      const err = new CliError('no_wallet', 'No wallets.', {
        nextSteps: { action: 'create_wallet', suggestion: 'run create' },
        extra: { held_chains: [] },
      });
      const code = writeError(err);
      expect(code).toBe(1);
      const payload = stderrSpy.mock.calls[0]?.[0] as string;
      expect(payload).toContain('"code":"no_wallet"');
      expect(payload).toContain('"action":"create_wallet"');
      expect(payload).toContain('"held_chains":[]');
    });

    it('emits human prose + machine-readable fallback in human mode', () => {
      setMode('human');
      const err = new CliError('insufficient_balance', 'Too poor.');
      const code = writeError(err);
      expect(code).toBe(3);
      const calls = stderrSpy.mock.calls.map((c) => c[0] as string);
      expect(calls.some((s) => s.includes('Too poor.'))).toBe(true);
      expect(calls.some((s) => s.includes('"insufficient_balance"'))).toBe(true);
    });

    it('maps error codes to exit codes', () => {
      setMode('json');
      expect(writeError(new CliError('network_error', ''))).toBe(2);
      expect(writeError(new CliError('no_funded_rail', ''))).toBe(3);
      expect(writeError(new CliError('max_spend_exceeded', ''))).toBe(4);
      expect(writeError(new CliError('multi_rail_candidates', ''))).toBe(5);
      expect(writeError(new CliError('unknown', ''))).toBe(1);
    });

    it('wraps plain Error as unknown code, exit 1', () => {
      setMode('json');
      const code = writeError(new Error('boom'));
      expect(code).toBe(1);
      const payload = stderrSpy.mock.calls[0]?.[0] as string;
      expect(payload).toContain('"code":"unknown"');
      expect(payload).toContain('"message":"boom"');
    });
  });
});
