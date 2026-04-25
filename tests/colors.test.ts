import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bold, cyan, dim, fail, FAILURE_MARK, green, ok, red, SUCCESS_MARK, yellow } from '../src/colors';
import { setMode } from '../src/output';

describe('colors', () => {
  beforeEach(() => {
    setMode('plain');
  });

  afterEach(() => {
    setMode('human');
  });

  describe('plain mode', () => {
    it('green returns plain text', () => {
      expect(green('hello')).toBe('hello');
    });

    it('red returns plain text', () => {
      expect(red('error')).toBe('error');
    });

    it('yellow returns plain text', () => {
      expect(yellow('warn')).toBe('warn');
    });

    it('cyan returns plain text', () => {
      expect(cyan('info')).toBe('info');
    });

    it('dim returns plain text', () => {
      expect(dim('subtle')).toBe('subtle');
    });

    it('bold returns plain text', () => {
      expect(bold('strong')).toBe('strong');
    });

    it('ok returns ✓ + text without ANSI', () => {
      expect(ok('done')).toBe(`${SUCCESS_MARK} done`);
    });

    it('fail returns ✗ + text without ANSI', () => {
      expect(fail('nope')).toBe(`${FAILURE_MARK} nope`);
    });
  });

  describe('json mode', () => {
    beforeEach(() => setMode('json'));
    it('still returns plain text (json should never have color)', () => {
      expect(green('x')).toBe('x');
    });
  });

  describe('human mode', () => {
    beforeEach(() => setMode('human'));
    it('returns text containing the input (color depends on TTY support)', () => {
      expect(green('hi')).toContain('hi');
      expect(red('hi')).toContain('hi');
      expect(bold('hi')).toContain('hi');
    });
  });
});
