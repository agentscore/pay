import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearPassport,
  expiresInDays,
  isExpired,
  loadPassport,
  PASSPORT_VERSION,
  savePassport,
  type Passport,
} from '../src/passport/storage';
import { passportPath } from '../src/paths';

describe('passport/storage', () => {
  let tmp: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pay-passport-'));
    prevHome = process.env.AGENTSCORE_PAY_HOME;
    process.env.AGENTSCORE_PAY_HOME = tmp;
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.AGENTSCORE_PAY_HOME;
    else process.env.AGENTSCORE_PAY_HOME = prevHome;
    await rm(tmp, { recursive: true, force: true });
  });

  it('returns null when the passport file does not exist', async () => {
    const result = await loadPassport();
    expect(result).toBeNull();
  });

  it('round-trips a passport via save → load', async () => {
    const passport: Passport = {
      version: PASSPORT_VERSION,
      operator_token: 'opc_test_abc123',
      operator_id: 'op_xyz',
      email: 'you@example.com',
      verified_facts: { kyc: true, age_bracket: '21+', jurisdiction: 'US', sanctions_clear: true },
      expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
      saved_at: Date.now(),
    };
    await savePassport(passport);
    const loaded = await loadPassport();
    expect(loaded).toEqual(passport);
  });

  it('writes to the path resolved from AGENTSCORE_PAY_HOME', async () => {
    expect(passportPath()).toBe(join(tmp, 'passport.json'));
  });

  it('clearPassport removes the file and reports cleared=true', async () => {
    const passport: Passport = {
      version: PASSPORT_VERSION,
      operator_token: 'opc_clear',
      expires_at: Date.now() + 1000,
      saved_at: Date.now(),
    };
    await savePassport(passport);
    expect(await loadPassport()).not.toBeNull();
    expect(await clearPassport()).toBe(true);
    expect(await loadPassport()).toBeNull();
  });

  it('clearPassport returns false when the file is already absent', async () => {
    expect(await clearPassport()).toBe(false);
  });

  it('returns null for malformed files (missing operator_token)', async () => {
    await savePassport({
      // Force a malformed shape past the type check
      ...(({} as Passport)),
      version: PASSPORT_VERSION,
      saved_at: Date.now(),
    } as Passport);
    const result = await loadPassport();
    expect(result).toBeNull();
  });

  it('isExpired flips when expires_at <= now', () => {
    const now = 1_000_000;
    const fresh: Passport = { version: 1, operator_token: 'opc_a', expires_at: now + 1, saved_at: now };
    const stale: Passport = { version: 1, operator_token: 'opc_b', expires_at: now - 1, saved_at: now };
    expect(isExpired(fresh, now)).toBe(false);
    expect(isExpired(stale, now)).toBe(true);
  });

  it('expiresInDays floors and clamps to zero', () => {
    const now = Date.UTC(2026, 4, 1, 0, 0, 0);
    const passport: Passport = {
      version: 1,
      operator_token: 'opc_c',
      expires_at: now + 5 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000,
      saved_at: now,
    };
    expect(expiresInDays(passport, now)).toBe(5);
    const expired: Passport = { ...passport, expires_at: now - 1 };
    expect(expiresInDays(expired, now)).toBe(0);
  });
});
