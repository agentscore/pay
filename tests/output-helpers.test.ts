import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emitProgress, isHuman, setMode, writeHumanNote, writeText } from '../src/output';

describe('output helpers', () => {
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

  describe('writeText', () => {
    it('writes to stdout without adding a newline', () => {
      writeText('hello');
      expect(stdoutSpy).toHaveBeenCalledWith('hello');
    });

    it('writes even in json mode (for raw body payloads)', () => {
      setMode('json');
      writeText('payload');
      expect(stdoutSpy).toHaveBeenCalledWith('payload');
    });
  });

  describe('writeHumanNote', () => {
    it('writes to stderr in human mode', () => {
      writeHumanNote('info');
      expect(stderrSpy).toHaveBeenCalledWith('info\n');
    });

    it('suppresses in json mode', () => {
      setMode('json');
      writeHumanNote('info');
      expect(stderrSpy).not.toHaveBeenCalled();
    });
  });

  describe('emitProgress', () => {
    it('emits structured JSON on stderr in json mode', () => {
      setMode('json');
      emitProgress('deposit_detected', { chain: 'base', usdc: '5.00' });
      const output = stderrSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('"event":"deposit_detected"');
      expect(output).toContain('"chain":"base"');
      expect(output).toContain('"usdc":"5.00"');
    });

    it('emits pretty text in human mode with data', () => {
      setMode('human');
      emitProgress('polling', { chain: 'base' });
      const output = stderrSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('polling');
      expect(output).toContain('base');
    });

    it('emits bare event in human mode without data', () => {
      setMode('human');
      emitProgress('timeout');
      expect(stderrSpy).toHaveBeenCalledWith('timeout\n');
    });
  });

  describe('mode switching', () => {
    it('isHuman reflects the active mode', () => {
      setMode('human');
      expect(isHuman()).toBe(true);
      setMode('json');
      expect(isHuman()).toBe(false);
      setMode('plain');
      expect(isHuman()).toBe(false);
    });
  });
});
