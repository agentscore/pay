import { Point } from '@noble/ed25519';
import { blake2b } from '@noble/hashes/blake2.js';
import { mnemonicToSeedSync } from '@scure/bip39';
import { describe, expect, it, vi } from 'vitest';
import {
  addressToPublicKey,
  balance,
  createRpc,
  deriveKeyFromSeed,
  formatBalance,
  hashStateBlock,
  keyToAddress,
  normalizeAddress,
  parseXno,
  publicKeyFromKey,
  publicKeyToAddress,
  send,
  signHash,
  type NanoRpc,
} from '../src/chains/nano';
import { ExactNanoScheme } from '../src/chains/nano-x402';
import { deriveKey } from '../src/mnemonic';

// Published Nano test vector (docs.nano.org integration guide): the all-zero seed at
// index 0 under the legacy derivation, private key = blake2b-256(seed || index_be32).
// The derivation is done here in the test; the module only maps key -> address.
const ZERO_SEED_SK = blake2b(new Uint8Array(36), { dkLen: 32 });
const ZERO_SEED_SK_HEX = '9f0e444c69f77a49bd0be89db92c38fe713e0963165cca12faf5712d7657120f';
const ZERO_SEED_PUB_HEX = 'c008b814a7d269a1fa3c6528b19201a24d797912db9996ff02a1ff356e45552b';
const ZERO_SEED_ADDR = 'nano_3i1aq1cchnmbn9x5rsbap8b15akfh7wj7pwskuzi7ahz8oq6cobd99d4r3b7';

// Published BIP-39 / SLIP-10 vector for m/44'/165'/0' (mnemonic + "some password").
const BIP39_PHRASE =
  'edge defense waste choose enrich upon flee junk siren film clown finish luggage leader kid quick brick print evidence swap drill paddle truly occur';
const BIP39_SK_HEX = '3be4fc2ef3f3b7374e6fc4fb6e7bb153f8a2998b3b3dab50853eabe128024143';
const BIP39_ADDR = 'nano_1pu7p5n3ghq1i1p4rhmek41f5add1uh34xpb94nkbxe8g4a6x1p69emk8y1d';

const L = Point.CURVE().n;
const le = (b: Uint8Array) => b.reduceRight((n, x) => (n << 8n) | BigInt(x), 0n);

/** Independent ed25519-blake2b verification: S*G == R + H(R||A||M)*A. */
function verify(sig: Uint8Array, msg: Uint8Array, pub: Uint8Array): boolean {
  const R = Point.fromBytes(sig.slice(0, 32));
  const S = le(sig.slice(32));
  const k = le(blake2b(new Uint8Array([...sig.slice(0, 32), ...pub, ...msg]), { dkLen: 64 })) % L;
  return Point.BASE.multiply(S).equals(R.add(Point.fromBytes(pub).multiply(k)));
}

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('nano keys and addresses', () => {
  it('maps the published zero-seed key to its published public key and address', () => {
    expect(hex(ZERO_SEED_SK)).toBe(ZERO_SEED_SK_HEX);
    expect(hex(publicKeyFromKey(ZERO_SEED_SK))).toBe(ZERO_SEED_PUB_HEX);
    expect(keyToAddress(Buffer.from(ZERO_SEED_SK))).toBe(ZERO_SEED_ADDR);
  });

  it("derives m/44'/165'/0' from a BIP-39 seed per the published vector", () => {
    const seed = Buffer.from(mnemonicToSeedSync(BIP39_PHRASE, 'some password'));
    expect(deriveKeyFromSeed(seed).toString('hex')).toBe(BIP39_SK_HEX);
    expect(keyToAddress(deriveKeyFromSeed(seed))).toBe(BIP39_ADDR);
  });

  it('deriveKey(nano) uses the same path on the mnemonic seed', () => {
    const viaMnemonic = deriveKey('nano', BIP39_PHRASE);
    expect(viaMnemonic.equals(deriveKeyFromSeed(Buffer.from(mnemonicToSeedSync(BIP39_PHRASE))))).toBe(true);
  });

  it('round-trips address <-> public key', () => {
    const pub = addressToPublicKey(ZERO_SEED_ADDR);
    expect(hex(pub)).toBe(ZERO_SEED_PUB_HEX);
    expect(publicKeyToAddress(pub)).toBe(ZERO_SEED_ADDR);
  });

  it('accepts the legacy xrb_ alias and normalizes it to nano_', () => {
    const xrb = ZERO_SEED_ADDR.replace(/^nano_/, 'xrb_');
    expect(hex(addressToPublicKey(xrb))).toBe(ZERO_SEED_PUB_HEX);
    expect(normalizeAddress(xrb)).toBe(ZERO_SEED_ADDR);
  });

  it('rejects a bad checksum', () => {
    const last = ZERO_SEED_ADDR.at(-1) === '1' ? '3' : '1';
    const bad = ZERO_SEED_ADDR.slice(0, -1) + last;
    expect(() => addressToPublicKey(bad)).toThrow(expect.objectContaining({ code: 'invalid_wallet_address' }));
  });

  it('rejects wrong prefix, length and alphabet', () => {
    for (const bad of [
      ZERO_SEED_ADDR.replace('nano_', 'ban_'),
      ZERO_SEED_ADDR.slice(0, -1),
      ZERO_SEED_ADDR.replace(/b7$/, 'l7'),
      '0x1234',
    ]) {
      expect(() => addressToPublicKey(bad)).toThrow(expect.objectContaining({ code: 'invalid_wallet_address' }));
    }
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => publicKeyFromKey(new Uint8Array(31))).toThrow(expect.objectContaining({ code: 'invalid_key' }));
  });
});

describe('nano amounts', () => {
  it('parses decimal XNO to raw exactly', () => {
    expect(parseXno('1')).toBe(10n ** 30n);
    expect(parseXno('0.000001')).toBe(10n ** 24n);
    expect(parseXno('0.000000000000000000000000000001')).toBe(1n);
  });

  it('refuses non-decimal input and more than 30 fractional digits', () => {
    for (const bad of ['', '-1', '1e3', 'abc', '0.0000000000000000000000000000001']) {
      expect(() => parseXno(bad)).toThrow(expect.objectContaining({ code: 'invalid_amount' }));
    }
  });

  it('formats raw exactly with trailing zeros trimmed', () => {
    expect(formatBalance(0n)).toBe('0.0');
    expect(formatBalance(15n * 10n ** 29n)).toBe('1.5');
    expect(formatBalance(1n)).toBe('0.000000000000000000000000000001');
  });
});

describe('nano state blocks', () => {
  const block = {
    account: ZERO_SEED_ADDR,
    previous: 'AB'.repeat(32),
    representative: ZERO_SEED_ADDR,
    balance: 123456789n,
    link: 'CD'.repeat(32),
  };

  it('hashes preamble || account || previous || rep || balance(16 BE) || link with blake2b-256', () => {
    const pub = Buffer.from(ZERO_SEED_PUB_HEX, 'hex');
    const bal = Buffer.alloc(16);
    bal.writeBigUInt64BE(123456789n, 8);
    const expected = blake2b(
      Buffer.concat([Buffer.alloc(31), Buffer.from([6]), pub, Buffer.from(block.previous, 'hex'), pub, bal, Buffer.from(block.link, 'hex')]),
      { dkLen: 32 },
    );
    expect(hex(hashStateBlock(block))).toBe(hex(expected));
  });

  it('signs block hashes with ed25519-blake2b', () => {
    const h = hashStateBlock(block);
    const sig = signHash(ZERO_SEED_SK, h);
    expect(verify(sig, h, publicKeyFromKey(ZERO_SEED_SK))).toBe(true);
    const other = new Uint8Array(h);
    other[0] ^= 1;
    expect(verify(sig, other, publicKeyFromKey(ZERO_SEED_SK))).toBe(false);
  });
});

const PAYEE_SK = blake2b(new Uint8Array([...new Uint8Array(32), 0, 0, 0, 1]), { dkLen: 32 });
const PAYEE = keyToAddress(Buffer.from(PAYEE_SK));
const FRONTIER = '1F'.repeat(32);
const XNO = 10n ** 30n;

function fakeRpc(opts: { balance?: bigint; missing?: boolean; processError?: string } = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const rpc: NanoRpc = async (body) => {
    calls.push(body);
    if (body.action === 'account_info') {
      if (opts.missing) throw new Error('Nano RPC account_info: Account not found');
      return { frontier: FRONTIER, balance: (opts.balance ?? 2n * XNO).toString(), representative: ZERO_SEED_ADDR };
    }
    if (body.action === 'work_generate') return { work: '0123456789abcdef' };
    if (body.action === 'process') {
      if (opts.processError) throw new Error(opts.processError);
      return {};
    }
    throw new Error(`unexpected ${String(body.action)}`);
  };
  return { rpc, calls };
}

describe('nano send', () => {
  it('builds, signs and publishes a state send block to the payee', async () => {
    const { rpc, calls } = fakeRpc();
    const res = await send({ key: Buffer.from(ZERO_SEED_SK), to: PAYEE, amountRaw: XNO / 2n, rpc });
    expect(calls.map((c) => c.action)).toEqual(['account_info', 'work_generate', 'process']);
    expect(calls[1]).toMatchObject({ hash: FRONTIER });
    const blk = (calls[2] as { block: Record<string, string> }).block;
    expect(blk).toMatchObject({
      type: 'state',
      account: ZERO_SEED_ADDR,
      previous: FRONTIER,
      representative: ZERO_SEED_ADDR,
      balance: (2n * XNO - XNO / 2n).toString(),
      link: hex(addressToPublicKey(PAYEE)).toUpperCase(),
      work: '0123456789abcdef',
    });
    const h = hashStateBlock({ ...blk, balance: BigInt(blk.balance) });
    expect(res.hash).toBe(hex(h).toUpperCase());
    expect(verify(Buffer.from(blk.signature, 'hex'), h, publicKeyFromKey(ZERO_SEED_SK))).toBe(true);
  });

  it('refuses before signing when the balance is short', async () => {
    const { rpc, calls } = fakeRpc({ balance: 1n });
    await expect(send({ key: Buffer.from(ZERO_SEED_SK), to: PAYEE, amountRaw: 2n, rpc })).rejects.toMatchObject({
      code: 'insufficient_balance',
    });
    expect(calls.map((c) => c.action)).toEqual(['account_info']);
  });

  it('treats an unopened account as insufficient balance', async () => {
    const { rpc } = fakeRpc({ missing: true });
    await expect(send({ key: Buffer.from(ZERO_SEED_SK), to: PAYEE, amountRaw: 1n, rpc })).rejects.toMatchObject({
      code: 'insufficient_balance',
    });
  });

  it('refuses zero and over-128-bit amounts', async () => {
    const { rpc, calls } = fakeRpc();
    for (const amountRaw of [0n, 1n << 128n]) {
      await expect(send({ key: Buffer.from(ZERO_SEED_SK), to: PAYEE, amountRaw, rpc })).rejects.toMatchObject({
        code: 'invalid_amount',
      });
    }
    expect(calls).toHaveLength(0);
  });

  it('rejects a node that reports a different block hash', async () => {
    const rpc: NanoRpc = async (body) =>
      body.action === 'account_info'
        ? { frontier: FRONTIER, balance: XNO.toString(), representative: ZERO_SEED_ADDR }
        : body.action === 'work_generate'
          ? { work: '0123456789abcdef' }
          : { hash: '00'.repeat(32) };
    await expect(send({ key: Buffer.from(ZERO_SEED_SK), to: PAYEE, amountRaw: 1n, rpc })).rejects.toThrow(/expected/);
  });
});

describe('nano rpc transport', () => {
  it('posts JSON and surfaces node errors', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'Bad account number' }), { status: 200 }));
    const rpc = createRpc('http://node.invalid', fetchImpl as unknown as typeof fetch);
    await expect(rpc({ action: 'account_balance' })).rejects.toThrow(/Bad account number/);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ action: 'account_balance' });
  });

  it('surfaces HTTP failures', async () => {
    const rpc = createRpc('http://node.invalid', (async () => new Response('', { status: 503 })) as unknown as typeof fetch);
    await expect(rpc({ action: 'process' })).rejects.toThrow(/HTTP 503/);
  });

  it('balance reads raw and wraps failures as rpc_error naming NANO_RPC_URL', async () => {
    await expect(balance(ZERO_SEED_ADDR, async () => ({ balance: '42' }))).resolves.toBe(42n);
    await expect(
      balance(ZERO_SEED_ADDR, async () => {
        throw new Error('down');
      }),
    ).rejects.toMatchObject({ code: 'rpc_error', nextSteps: { suggestion: expect.stringContaining('NANO_RPC_URL') } });
    await expect(balance(ZERO_SEED_ADDR, async () => ({ balance: '1.5' }))).rejects.toMatchObject({ code: 'rpc_error' });
  });
});

describe('ExactNanoScheme', () => {
  const requirements = {
    scheme: 'exact',
    network: 'nano:mainnet' as const,
    asset: 'XNO',
    amount: (XNO / 100n).toString(),
    payTo: PAYEE,
    maxTimeoutSeconds: 60,
    extra: {},
  };

  it('returns the published block hash as the payload', async () => {
    const { rpc } = fakeRpc();
    const scheme = new ExactNanoScheme({ key: Buffer.from(ZERO_SEED_SK), rpc });
    const out = await scheme.createPaymentPayload(2, requirements);
    expect(out.x402Version).toBe(2);
    expect(out.payload).toEqual({ blockHash: expect.stringMatching(/^[0-9A-F]{64}$/) });
  });

  it('refuses a decimals declaration other than 30 and reports it through onError', async () => {
    const { rpc, calls } = fakeRpc();
    const onError = vi.fn();
    const scheme = new ExactNanoScheme({ key: Buffer.from(ZERO_SEED_SK), rpc, onError });
    await expect(scheme.createPaymentPayload(2, { ...requirements, extra: { decimals: 6 } })).rejects.toMatchObject({
      code: 'merchant_spec_violation',
    });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'merchant_spec_violation' }));
    expect(calls).toHaveLength(0);
  });

  it('refuses a non-integer amount', async () => {
    const { rpc, calls } = fakeRpc();
    const scheme = new ExactNanoScheme({ key: Buffer.from(ZERO_SEED_SK), rpc });
    await expect(scheme.createPaymentPayload(2, { ...requirements, amount: '0.01' })).rejects.toMatchObject({
      code: 'merchant_spec_violation',
    });
    expect(calls).toHaveLength(0);
  });
});
