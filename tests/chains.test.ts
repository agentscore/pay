import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as base from '../src/chains/base';
import * as solana from '../src/chains/solana';
import * as tempo from '../src/chains/tempo';
import { CliError } from '../src/errors';

const EVM_SEED = Buffer.from('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff', 'hex');
const SOLANA_SEED = Buffer.from('11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff', 'hex');

describe('chains/base', () => {
  it('generateKey returns 32 bytes', () => {
    const key = base.generateKey();
    expect(key.length).toBe(32);
  });

  it('keyToAddress is deterministic and hex-prefixed', () => {
    const addr1 = base.keyToAddress(EVM_SEED);
    const addr2 = base.keyToAddress(EVM_SEED);
    expect(addr1).toBe(addr2);
    expect(addr1).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('createSigner returns a signer with address + signTypedData', () => {
    const signer = base.createSigner(EVM_SEED);
    expect(signer.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(typeof signer.signTypedData).toBe('function');
    expect(typeof signer.readContract).toBe('function');
  });

  it('formatBalance pads the fractional part to 6 digits', () => {
    expect(base.formatBalance(0n)).toBe('0.000000');
    expect(base.formatBalance(1n)).toBe('0.000001');
    expect(base.formatBalance(1_000_000n)).toBe('1.000000');
    expect(base.formatBalance(1_234_567n)).toBe('1.234567');
    expect(base.formatBalance(10_000_000_000_000n)).toBe('10000000.000000');
  });
});

describe('chains balance() error paths', () => {
  let originalBase: string | undefined;
  let originalSvm: string | undefined;
  let originalTempo: string | undefined;

  beforeEach(() => {
    originalBase = process.env.BASE_RPC_URL;
    originalSvm = process.env.SOLANA_RPC_URL;
    originalTempo = process.env.TEMPO_RPC_URL;
    process.env.BASE_RPC_URL = 'http://127.0.0.1:0';
    process.env.SOLANA_RPC_URL = 'http://127.0.0.1:0';
    process.env.TEMPO_RPC_URL = 'http://127.0.0.1:0';
  });

  afterEach(() => {
    if (originalBase === undefined) delete process.env.BASE_RPC_URL;
    else process.env.BASE_RPC_URL = originalBase;
    if (originalSvm === undefined) delete process.env.SOLANA_RPC_URL;
    else process.env.SOLANA_RPC_URL = originalSvm;
    if (originalTempo === undefined) delete process.env.TEMPO_RPC_URL;
    else process.env.TEMPO_RPC_URL = originalTempo;
  });

  it('base balance() throws rpc_error when RPC unreachable', async () => {
    await expect(base.balance('0x1111111111111111111111111111111111111111')).rejects.toSatisfy(
      (err) => err instanceof CliError && err.code === 'rpc_error',
    );
  });

  it('solana balance() throws rpc_error when RPC unreachable', async () => {
    await expect(solana.balance('4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T')).rejects.toSatisfy(
      (err) => err instanceof CliError && err.code === 'rpc_error',
    );
  }, 15_000);

  it('tempo balance() throws rpc_error when RPC unreachable', async () => {
    await expect(tempo.balance('0x1111111111111111111111111111111111111111')).rejects.toSatisfy(
      (err) => err instanceof CliError && err.code === 'rpc_error',
    );
  });
});

describe('chains/solana', () => {
  it('generateKey returns 32 bytes', () => {
    const key = solana.generateKey();
    expect(key.length).toBe(32);
  });

  it('keyToAddress is deterministic and base58', async () => {
    const addr1 = await solana.keyToAddress(SOLANA_SEED);
    const addr2 = await solana.keyToAddress(SOLANA_SEED);
    expect(addr1).toBe(addr2);
    expect(addr1).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  it('createSigner returns a signer with an address', async () => {
    const signer = await solana.createSigner(SOLANA_SEED);
    expect(signer.address).toBeTruthy();
    expect(typeof signer.address).toBe('string');
  });

  it('formatBalance pads the fractional part to 6 digits', () => {
    expect(solana.formatBalance(0n)).toBe('0.000000');
    expect(solana.formatBalance(1_500_000n)).toBe('1.500000');
  });
});

describe('chains/tempo', () => {
  it('generateKey returns 32 bytes', () => {
    const key = tempo.generateKey();
    expect(key.length).toBe(32);
  });

  it('keyToAddress is deterministic and hex-prefixed', () => {
    const addr1 = tempo.keyToAddress(EVM_SEED);
    const addr2 = tempo.keyToAddress(EVM_SEED);
    expect(addr1).toBe(addr2);
    expect(addr1).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('createAccount returns a viem Account', () => {
    const account = tempo.createAccount(EVM_SEED);
    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(typeof account.signTypedData).toBe('function');
  });

  it('EVM keyToAddress is shared across base + tempo (same derivation)', () => {
    expect(base.keyToAddress(EVM_SEED)).toBe(tempo.keyToAddress(EVM_SEED));
  });

  it('formatBalance pads the fractional part to 6 digits', () => {
    expect(tempo.formatBalance(0n)).toBe('0.000000');
    expect(tempo.formatBalance(999_999n)).toBe('0.999999');
  });
});
