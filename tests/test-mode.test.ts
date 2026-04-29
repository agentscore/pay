import { describe, expect, it } from 'vitest';
import { AGENTSCORE_TEST_ADDRESSES, isAgentScoreTestAddress } from '../src/test-mode';

describe('isAgentScoreTestAddress', () => {
  it('returns true for each of the 7 reserved EVM addresses', () => {
    for (let i = 1; i <= 7; i++) {
      const addr = `0x${'0'.repeat(39)}${i}`;
      expect(isAgentScoreTestAddress(addr)).toBe(true);
    }
  });

  it('matches case-insensitively (uppercase hex still recognized)', () => {
    expect(isAgentScoreTestAddress('0x0000000000000000000000000000000000000001'.toUpperCase())).toBe(
      true,
    );
  });

  it('returns false for addresses outside the reserved range', () => {
    expect(isAgentScoreTestAddress('0x0000000000000000000000000000000000000008')).toBe(false);
    expect(isAgentScoreTestAddress('0xabcabcabcabcabcabcabcabcabcabcabcabcabca')).toBe(false);
  });

  it('returns false for null / undefined / empty', () => {
    expect(isAgentScoreTestAddress(null)).toBe(false);
    expect(isAgentScoreTestAddress(undefined)).toBe(false);
    expect(isAgentScoreTestAddress('')).toBe(false);
  });
});

describe('AGENTSCORE_TEST_ADDRESSES', () => {
  it('exports exactly 7 reserved addresses', () => {
    expect(AGENTSCORE_TEST_ADDRESSES).toHaveLength(7);
  });

  it('every entry passes isAgentScoreTestAddress', () => {
    for (const addr of AGENTSCORE_TEST_ADDRESSES) {
      expect(isAgentScoreTestAddress(addr)).toBe(true);
    }
  });
});
