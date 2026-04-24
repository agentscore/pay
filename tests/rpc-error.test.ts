import { describe, expect, it } from 'vitest';
import { CliError, exitCodeForError, wrapRpcError } from '../src/errors';

describe('wrapRpcError', () => {
  it('wraps an Error into CliError with rpc_error code', () => {
    const err = wrapRpcError('base', 'mainnet', new Error('HTTP 429: Too Many Requests'));
    expect(err).toBeInstanceOf(CliError);
    expect(err.code).toBe('rpc_error');
    expect(err.message).toContain('base mainnet');
    expect(err.message).toContain('HTTP 429');
    expect(exitCodeForError(err.code)).toBe(2);
  });

  it('suggests BASE_RPC_URL for base mainnet failures', () => {
    const err = wrapRpcError('base', 'mainnet', new Error('boom'));
    expect(err.nextSteps?.suggestion).toContain('BASE_RPC_URL');
  });

  it('suggests BASE_SEPOLIA_RPC_URL for base testnet failures', () => {
    const err = wrapRpcError('base', 'testnet', new Error('boom'));
    expect(err.nextSteps?.suggestion).toContain('BASE_SEPOLIA_RPC_URL');
  });

  it('suggests SOLANA_DEVNET_RPC_URL for solana testnet failures', () => {
    const err = wrapRpcError('solana', 'testnet', new Error('boom'));
    expect(err.nextSteps?.suggestion).toContain('SOLANA_DEVNET_RPC_URL');
  });

  it('suggests TEMPO_RPC_URL for tempo mainnet failures', () => {
    const err = wrapRpcError('tempo', 'mainnet', new Error('boom'));
    expect(err.nextSteps?.suggestion).toContain('TEMPO_RPC_URL');
  });

  it('preserves CliError when the upstream error is already one', () => {
    const original = new CliError('max_spend_exceeded', 'too expensive');
    const err = wrapRpcError('base', 'mainnet', original);
    expect(err).toBe(original);
  });

  it('handles non-Error values', () => {
    const err = wrapRpcError('base', 'mainnet', 'string error');
    expect(err.code).toBe('rpc_error');
    expect(err.message).toContain('string error');
  });
});
