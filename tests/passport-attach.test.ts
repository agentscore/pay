import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachPassport, attachResultToHeaders } from '../src/passport/attach';
import { savePassport, type Passport } from '../src/passport/storage';

describe('passport/attach', () => {
  let tmp: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pay-attach-'));
    prevHome = process.env.AGENTSCORE_PAY_HOME;
    process.env.AGENTSCORE_PAY_HOME = tmp;
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.AGENTSCORE_PAY_HOME;
    else process.env.AGENTSCORE_PAY_HOME = prevHome;
    await rm(tmp, { recursive: true, force: true });
  });

  function makePassport(overrides: Partial<Passport> = {}): Passport {
    return {
      version: 1,
      operator_token: 'opc_test_xyz',
      expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
      saved_at: Date.now(),
      ...overrides,
    };
  }

  it('returns kind: absent when no passport stored', async () => {
    const result = await attachPassport();
    expect(result.kind).toBe('absent');
    expect(attachResultToHeaders(result)).toEqual({});
  });

  it('returns kind: opted_out when noPassport=true even if a passport is stored', async () => {
    await savePassport(makePassport());
    const result = await attachPassport({ noPassport: true });
    expect(result.kind).toBe('opted_out');
    expect(attachResultToHeaders(result)).toEqual({});
  });

  it('returns kind: opted_out when caller already supplied X-Operator-Token', async () => {
    await savePassport(makePassport());
    const result = await attachPassport({ callerSuppliedOperatorToken: 'opc_caller' });
    expect(result.kind).toBe('opted_out');
  });

  it('returns kind: attached + operator_token when valid passport stored', async () => {
    await savePassport(makePassport({ operator_token: 'opc_valid_token' }));
    const result = await attachPassport();
    expect(result.kind).toBe('attached');
    expect(result.operatorToken).toBe('opc_valid_token');
    expect(attachResultToHeaders(result)).toEqual({ 'X-Operator-Token': 'opc_valid_token' });
  });

  it('returns kind: expired when stored passport past expiry', async () => {
    const past = Date.now() - 1000;
    await savePassport(makePassport({ expires_at: past }));
    const result = await attachPassport();
    expect(result.kind).toBe('expired');
    expect(result.passport).toBeDefined();
    expect(attachResultToHeaders(result)).toEqual({});
  });

  it('flags expiringSoon=true when within 5 days of expiry', async () => {
    const now = Date.now();
    const passport = makePassport({ expires_at: now + 4 * 24 * 60 * 60 * 1000 });
    await savePassport(passport);
    const result = await attachPassport({ now });
    expect(result.kind).toBe('attached');
    expect(result.expiringSoon).toBe(true);
  });

  it('expiringSoon=false when comfortably away from expiry', async () => {
    const now = Date.now();
    const passport = makePassport({ expires_at: now + 20 * 24 * 60 * 60 * 1000 });
    await savePassport(passport);
    const result = await attachPassport({ now });
    expect(result.kind).toBe('attached');
    expect(result.expiringSoon).toBe(false);
  });
});
