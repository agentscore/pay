import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
