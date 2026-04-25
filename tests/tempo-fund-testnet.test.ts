import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fundTestnet } from '../src/chains/tempo';
import { CliError } from '../src/errors';

describe('chains/tempo fundTestnet', () => {
  let originalRpcUrl: string | undefined;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalRpcUrl = process.env.TEMPO_TESTNET_RPC_URL;
    process.env.TEMPO_TESTNET_RPC_URL = 'http://127.0.0.1:0';
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalRpcUrl === undefined) delete process.env.TEMPO_TESTNET_RPC_URL;
    else process.env.TEMPO_TESTNET_RPC_URL = originalRpcUrl;
    globalThis.fetch = originalFetch;
  });

  it('returns transaction hashes on success', async () => {
    const txs = ['0xaa', '0xbb', '0xcc', '0xdd'];
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ jsonrpc: '2.0', id: 1, result: txs }),
    } as Response);
    const result = await fundTestnet('0x1111111111111111111111111111111111111111');
    expect(result).toEqual(txs);
  });

  it('sends correct JSON-RPC request shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ jsonrpc: '2.0', id: 1, result: [] }),
    } as Response);
    globalThis.fetch = fetchMock;
    await fundTestnet('0x1234567890abcdef1234567890abcdef12345678');
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0];
    const body = JSON.parse(call[1].body as string);
    expect(body.method).toBe('tempo_fundAddress');
    expect(body.params).toEqual(['0x1234567890abcdef1234567890abcdef12345678']);
    expect(body.jsonrpc).toBe('2.0');
  });

  it('throws CliError(rpc_error) when RPC returns error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32603, message: 'rate limited' },
      }),
    } as Response);
    await expect(fundTestnet('0x1111111111111111111111111111111111111111')).rejects.toMatchObject({
      code: 'rpc_error',
      extra: { rpc_code: -32603 },
    });
  });

  it('throws CliError when result is missing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ jsonrpc: '2.0', id: 1 }),
    } as Response);
    await expect(fundTestnet('0x1111111111111111111111111111111111111111')).rejects.toBeInstanceOf(CliError);
  });

  it('throws wrapped rpc_error when fetch fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(fundTestnet('0x1111111111111111111111111111111111111111')).rejects.toMatchObject({
      code: 'rpc_error',
    });
  });
});
