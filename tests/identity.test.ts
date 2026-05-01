import {
  AgentScore,
  AgentScoreError,
  InvalidCredentialError,
  PaymentRequiredError,
  QuotaExceededError,
  RateLimitedError,
  TimeoutError as SdkTimeoutError,
  TokenExpiredError,
} from '@agent-score/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assess,
  associateWallet,
  credentialCreate,
  credentialList,
  credentialRevoke,
  reputation,
  sessionCreate,
  sessionGet,
} from '../src/commands/identity';

describe('identity commands', () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.AGENTSCORE_API_KEY;
    delete process.env.AGENTSCORE_API_KEY;
  });

  afterEach(() => {
    if (originalKey !== undefined) process.env.AGENTSCORE_API_KEY = originalKey;
  });

  it('reputation rejects with config_error when API key is missing', async () => {
    await expect(reputation({ address: '0xabc' })).rejects.toMatchObject({ code: 'config_error' });
  });

  it('assess rejects when neither address nor operator-token is provided', async () => {
    process.env.AGENTSCORE_API_KEY = 'as_test_dummy';
    await expect(assess({})).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('assess rejects with config_error when API key is missing', async () => {
    await expect(assess({ address: '0xabc' })).rejects.toMatchObject({ code: 'config_error' });
  });

  it('sessionCreate rejects with config_error when API key is missing', async () => {
    await expect(sessionCreate({})).rejects.toMatchObject({ code: 'config_error' });
  });

  it('sessionGet rejects with config_error when API key is missing', async () => {
    await expect(sessionGet({ id: 'sess_x' })).rejects.toMatchObject({ code: 'config_error' });
  });

  it('credentialCreate rejects with config_error when API key is missing', async () => {
    await expect(credentialCreate({})).rejects.toMatchObject({ code: 'config_error' });
  });

  it('credentialList rejects with config_error when API key is missing', async () => {
    await expect(credentialList()).rejects.toMatchObject({ code: 'config_error' });
  });

  it('credentialRevoke rejects with config_error when API key is missing', async () => {
    await expect(credentialRevoke({ id: 'cred_x' })).rejects.toMatchObject({ code: 'config_error' });
  });

  it('associateWallet rejects with config_error when API key is missing', async () => {
    await expect(
      associateWallet({ operatorToken: 'opc_x', walletAddress: '0xabc', network: 'evm' }),
    ).rejects.toMatchObject({ code: 'config_error' });
  });
});

describe('identity commands — SDK typed-error mapping', () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.AGENTSCORE_API_KEY;
    process.env.AGENTSCORE_API_KEY = 'as_test_dummy';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalKey === undefined) {
      delete process.env.AGENTSCORE_API_KEY;
    } else {
      process.env.AGENTSCORE_API_KEY = originalKey;
    }
  });

  it('PaymentRequiredError → insufficient_balance with upgrade_plan suggestion', async () => {
    vi.spyOn(AgentScore.prototype, 'assess').mockRejectedValueOnce(
      new PaymentRequiredError('Endpoint not enabled'),
    );
    await expect(assess({ address: '0xabc' })).rejects.toMatchObject({
      code: 'insufficient_balance',
      nextSteps: { action: 'upgrade_plan' },
    });
  });

  it('TokenExpiredError → config_error exposing verify_url + session_id + poll_secret in extra', async () => {
    vi.spyOn(AgentScore.prototype, 'assess').mockRejectedValueOnce(
      new TokenExpiredError('Token expired', {
        verify_url: 'https://agentscore.sh/verify/abc',
        session_id: 'sess_123',
        poll_secret: 'ps_456',
      }),
    );
    await expect(assess({ operatorToken: 'opc_x' })).rejects.toMatchObject({
      code: 'config_error',
      nextSteps: { action: 'reauth' },
      extra: {
        verify_url: 'https://agentscore.sh/verify/abc',
        session_id: 'sess_123',
        poll_secret: 'ps_456',
      },
    });
  });

  it('InvalidCredentialError → config_error with switch_token_or_restart_session, no API-key drop', async () => {
    vi.spyOn(AgentScore.prototype, 'assess').mockRejectedValueOnce(
      new InvalidCredentialError('Token unknown'),
    );
    await expect(assess({ operatorToken: 'opc_bogus' })).rejects.toMatchObject({
      code: 'config_error',
      nextSteps: {
        action: 'switch_token_or_restart_session',
        // Regression guard: must NOT tell the user to drop AGENTSCORE_API_KEY
        // (invalid_credential is about operator_token, not API key).
        suggestion: expect.not.stringContaining('AGENTSCORE_API_KEY'),
      },
    });
  });

  it('QuotaExceededError → quota_exceeded with upgrade_plan, NOT contact_merchant', async () => {
    vi.spyOn(AgentScore.prototype, 'assess').mockRejectedValueOnce(
      new QuotaExceededError('Account quota exceeded'),
    );
    await expect(assess({ address: '0xabc' })).rejects.toMatchObject({
      code: 'quota_exceeded',
      // Pay calls AgentScore directly; the API consumer = the entity hitting quota.
      // Action is upgrade_plan (own plan), not contact_merchant (which makes sense in
      // commerce-gate context where merchant = third-party website).
      nextSteps: { action: 'upgrade_plan' },
    });
  });

  it('RateLimitedError → network_error with retry_with_backoff', async () => {
    vi.spyOn(AgentScore.prototype, 'assess').mockRejectedValueOnce(
      new RateLimitedError('Per-second cap hit'),
    );
    await expect(assess({ address: '0xabc' })).rejects.toMatchObject({
      code: 'network_error',
      nextSteps: { action: 'retry_with_backoff' },
    });
  });

  it('SdkTimeoutError → network_error with retry_with_backoff', async () => {
    vi.spyOn(AgentScore.prototype, 'assess').mockRejectedValueOnce(
      new SdkTimeoutError('Request timed out'),
    );
    await expect(assess({ address: '0xabc' })).rejects.toMatchObject({
      code: 'network_error',
      nextSteps: { action: 'retry_with_backoff' },
    });
  });

  it('Generic AgentScoreError 401 → config_error (check_api_key)', async () => {
    vi.spyOn(AgentScore.prototype, 'assess').mockRejectedValueOnce(
      new AgentScoreError('unauthorized', 'Bad key', 401),
    );
    await expect(assess({ address: '0xabc' })).rejects.toMatchObject({
      code: 'config_error',
      nextSteps: { action: 'check_api_key' },
    });
  });

  it('Generic AgentScoreError network_error → network_error CliError', async () => {
    vi.spyOn(AgentScore.prototype, 'assess').mockRejectedValueOnce(
      new AgentScoreError('network_error', 'DNS failed', 0),
    );
    await expect(assess({ address: '0xabc' })).rejects.toMatchObject({
      code: 'network_error',
      nextSteps: { action: 'retry_with_backoff' },
    });
  });

  it('AssessResponse.quota field flows through pay\'s JSON envelope', async () => {
    // SDK populates `quota` on AssessResponse from X-Quota-* headers; pay's assess()
    // returns the SDK response unchanged, so `c.ok(result)` serializes it into the
    // structured envelope without further wiring. Regression guard for that contract.
    vi.spyOn(AgentScore.prototype, 'assess').mockResolvedValueOnce({
      decision: 'allow',
      decision_reasons: [],
      identity_method: 'wallet',
      on_the_fly: false,
      updated_at: '2026-01-01T00:00:00Z',
      quota: { limit: 1000, used: 780, reset: '2026-06-01T00:00:00Z' },
    });
    const result = await assess({ address: '0xabc' });
    expect(result.quota).toEqual({ limit: 1000, used: 780, reset: '2026-06-01T00:00:00Z' });
  });
});
