import { Point } from '@noble/ed25519';
import { blake2b } from '@noble/hashes/blake2.js';
import { derivePath } from 'ed25519-hd-key';
import { nanoConfig } from '../constants';
import { CliError, wrapRpcError } from '../errors';

// Nano signs with ed25519 but swaps SHA-512 for BLAKE2b-512 in key expansion and
// in the nonce/challenge hashes, so the stock ed25519 helpers cannot be reused;
// the curve arithmetic comes from @noble/ed25519's Point.

const NANO_DERIVATION_PATH = "m/44'/165'/0'";
const ADDRESS_ALPHABET = '13456789abcdefghijkmnopqrstuwxyz';
const ADDRESS_RE = /^(nano|xrb)_([13][13456789abcdefghijkmnopqrstuwxyz]{59})$/;
const RAW_PER_XNO = 10n ** 30n;
const MAX_RAW = (1n << 128n) - 1n;
const ZERO_HASH = '0'.repeat(64);
const L = Point.CURVE().n;

function bytesToBigIntLE(bytes: Uint8Array): bigint {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]);
  return n;
}

function bigIntToBytesLE(n: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

function hexToBytes(hex: string, length: number): Uint8Array {
  if (!new RegExp(`^[0-9a-fA-F]{${length * 2}}$`).test(hex)) {
    throw new Error(`Expected ${length}-byte hex, got: ${hex}`);
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex').toUpperCase();
}

function expandKey(key: Uint8Array): { scalar: bigint; prefix: Uint8Array } {
  const h = blake2b(key, { dkLen: 64 });
  const a = h.slice(0, 32);
  a[0] &= 248;
  a[31] &= 127;
  a[31] |= 64;
  return { scalar: bytesToBigIntLE(a) % L, prefix: h.slice(32) };
}

function hashToScalar(...parts: Uint8Array[]): bigint {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  return bytesToBigIntLE(blake2b(buf, { dkLen: 64 })) % L;
}

export function generateKey(): Buffer {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
}

/** SLIP-10 ed25519 derivation at m/44'/165'/0' (the BIP-44 path Nano wallets use for a BIP-39 seed). */
export function deriveKeyFromSeed(seed: Buffer): Buffer {
  const { key } = derivePath(NANO_DERIVATION_PATH, seed.toString('hex'));
  return Buffer.from(key);
}

export function publicKeyFromKey(key: Uint8Array): Uint8Array {
  if (key.length !== 32) throw new CliError('invalid_key', `Nano private key must be 32 bytes, got ${key.length}.`);
  return Point.BASE.multiply(expandKey(key).scalar).toBytes();
}

/** ed25519-blake2b signature over a 32-byte block hash. */
export function signHash(key: Uint8Array, hash: Uint8Array): Uint8Array {
  const { scalar, prefix } = expandKey(key);
  const pub = Point.BASE.multiply(scalar).toBytes();
  const r = hashToScalar(prefix, hash);
  const R = Point.BASE.multiply(r).toBytes();
  const k = hashToScalar(R, pub, hash);
  const s = (r + k * scalar) % L;
  const sig = new Uint8Array(64);
  sig.set(R, 0);
  sig.set(bigIntToBytesLE(s, 32), 32);
  return sig;
}

function encodeBase32(bytes: Uint8Array, bits: number): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  for (let i = bits / 5 - 1; i >= 0; i--) out += ADDRESS_ALPHABET[Number((n >> BigInt(i * 5)) & 31n)];
  return out;
}

function decodeBase32(chars: string): bigint {
  let n = 0n;
  for (const c of chars) n = (n << 5n) | BigInt(ADDRESS_ALPHABET.indexOf(c));
  return n;
}

function checksum(pub: Uint8Array): Uint8Array {
  return blake2b(pub, { dkLen: 5 }).reverse();
}

export function publicKeyToAddress(pub: Uint8Array): string {
  return `nano_${encodeBase32(pub, 260)}${encodeBase32(checksum(pub), 40)}`;
}

export function keyToAddress(key: Buffer): string {
  return publicKeyToAddress(publicKeyFromKey(key));
}

/** Decode a `nano_` or legacy `xrb_` address, rejecting a bad prefix, alphabet or checksum. */
export function addressToPublicKey(address: string): Uint8Array {
  const m = ADDRESS_RE.exec(address);
  if (!m) {
    throw new CliError('invalid_wallet_address', `Not a Nano address: ${address}`);
  }
  const body = m[2];
  const pubN = decodeBase32(body.slice(0, 52));
  const pub = new Uint8Array(32);
  for (let i = 0; i < 32; i++) pub[i] = Number((pubN >> BigInt((31 - i) * 8)) & 0xffn);
  if (encodeBase32(checksum(pub), 40) !== body.slice(52)) {
    throw new CliError('invalid_wallet_address', `Nano address checksum mismatch: ${address}`);
  }
  return pub;
}

/** Canonical `nano_` form of a `nano_` or `xrb_` address. */
export function normalizeAddress(address: string): string {
  return publicKeyToAddress(addressToPublicKey(address));
}

/** Exact XNO decimal for a raw amount, trailing zeros trimmed (prices can sit far below 10^-6 XNO). */
export function formatBalance(raw: bigint): string {
  const whole = raw / RAW_PER_XNO;
  const frac = (raw % RAW_PER_XNO).toString().padStart(30, '0').replace(/0+$/, '');
  return `${whole.toString()}.${frac || '0'}`;
}

/** Exact decimal XNO -> raw. No floating point: 1 raw is 10^-30 XNO. */
export function parseXno(amount: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,30}))?$/.exec(amount.trim());
  if (!m) {
    throw new CliError('invalid_amount', `Not an XNO amount: ${amount}`, {
      nextSteps: { action: 'fix_amount', suggestion: 'Pass a decimal XNO amount, e.g. 0.01.' },
    });
  }
  return BigInt(m[1]) * RAW_PER_XNO + BigInt((m[2] ?? '').padEnd(30, '0'));
}

interface StateBlock {
  account: string;
  previous: string;
  representative: string;
  balance: bigint;
  link: string;
}

export function hashStateBlock(block: StateBlock): Uint8Array {
  const preamble = new Uint8Array(32);
  preamble[31] = 6;
  const balance = new Uint8Array(16);
  let b = block.balance;
  for (let i = 15; i >= 0; i--) {
    balance[i] = Number(b & 0xffn);
    b >>= 8n;
  }
  const parts = [
    preamble,
    addressToPublicKey(block.account),
    hexToBytes(block.previous, 32),
    addressToPublicKey(block.representative),
    balance,
    hexToBytes(block.link, 32),
  ];
  const buf = new Uint8Array(32 * 5 + 16);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  return blake2b(buf, { dkLen: 32 });
}

export type NanoRpc = (body: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** JSON-RPC over HTTP to a Nano node (or a proxy that also serves work_generate). */
export function createRpc(url: string = nanoConfig().rpcUrl, fetchImpl: typeof fetch = fetch): NanoRpc {
  return async (body) => {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Nano RPC ${String(body.action)} returned HTTP ${res.status}`);
    const json = (await res.json()) as Record<string, unknown>;
    if (typeof json.error === 'string') throw new Error(`Nano RPC ${String(body.action)}: ${json.error}`);
    return json;
  };
}

function rawField(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error(`Nano RPC returned a non-integer ${field}`);
  return BigInt(value);
}

export async function balance(address: string, rpc: NanoRpc = createRpc()): Promise<bigint> {
  try {
    const res = await rpc({ action: 'account_balance', account: address });
    return rawField(res.balance, 'balance');
  } catch (err: unknown) {
    throw wrapRpcError('nano', 'mainnet', err);
  }
}

export interface SendResult {
  hash: string;
  from: string;
  to: string;
  amount_raw: string;
}

/**
 * Build, sign and publish a state send block. Work comes from the node's
 * `work_generate`, so the caller needs an RPC that serves it. Insufficient funds
 * abort before anything is signed; transport failures surface as plain errors.
 */
export async function send(input: { key: Buffer; to: string; amountRaw: bigint; rpc?: NanoRpc }): Promise<SendResult> {
  const rpc = input.rpc ?? createRpc();
  const to = normalizeAddress(input.to);
  const linkPub = addressToPublicKey(to);
  if (input.amountRaw <= 0n || input.amountRaw > MAX_RAW) {
    throw new CliError('invalid_amount', `Nano send amount out of range: ${input.amountRaw.toString()} raw`);
  }
  const from = keyToAddress(input.key);

  const info = await rpc({ action: 'account_info', account: from, representative: 'true' }).catch((err: unknown) => {
    if (err instanceof Error && /account not found/i.test(err.message)) {
      throw new CliError('insufficient_balance', `Nano account ${from} is unopened (no receive yet).`, {
        nextSteps: { action: 'fund_wallet', suggestion: `Send XNO to ${from} and receive it before paying.` },
        extra: { chain: 'nano', address: from },
      });
    }
    throw err;
  });
  const current = rawField(info.balance, 'balance');
  if (current < input.amountRaw) {
    throw new CliError('insufficient_balance', `Nano wallet holds ${formatBalance(current)} XNO, needs ${formatBalance(input.amountRaw)}.`, {
      nextSteps: { action: 'fund_wallet', suggestion: `Send XNO to ${from}.` },
      extra: { chain: 'nano', address: from, balance_raw: current.toString(), amount_raw: input.amountRaw.toString() },
    });
  }
  const previous = typeof info.frontier === 'string' ? info.frontier.toUpperCase() : ZERO_HASH;
  const representative = typeof info.representative === 'string' ? info.representative : from;

  const block: StateBlock = {
    account: from,
    previous,
    representative,
    balance: current - input.amountRaw,
    link: toHex(linkPub),
  };
  const hash = hashStateBlock(block);
  const signature = signHash(input.key, hash);
  const work = await rpc({ action: 'work_generate', hash: previous });
  if (typeof work.work !== 'string') throw new Error('Nano RPC work_generate returned no work');

  const processed = await rpc({
    action: 'process',
    json_block: 'true',
    subtype: 'send',
    block: {
      type: 'state',
      account: block.account,
      previous: block.previous,
      representative: block.representative,
      balance: block.balance.toString(),
      link: block.link,
      signature: toHex(signature),
      work: work.work,
    },
  });
  const blockHash = toHex(hash);
  if (typeof processed.hash === 'string' && processed.hash.toUpperCase() !== blockHash) {
    throw new Error(`Nano node processed ${processed.hash}, expected ${blockHash}`);
  }
  return { hash: blockHash, from, to, amount_raw: input.amountRaw.toString() };
}

export function qrUri(addr: string): string {
  return `nano:${addr}`;
}
