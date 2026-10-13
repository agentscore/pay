import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blake2b } from '@noble/hashes/blake2.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addressToPublicKey, keyToAddress } from '../src/chains/nano';
import { pay } from '../src/commands/pay';
import { createWallet } from '../src/wallets';

// The nano rail never goes through selectRail; this stub only serves the Base
// control case, which would otherwise read a live USDC balance.
vi.mock('../src/selection', () => ({
  selectRail: vi.fn().mockResolvedValue({
    chain: 'base',
    name: 'default',
    address: '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf',
    balance_raw: 5_000_000n,
    balance_usdc: '5.000000',
  }),
}));

const PASS = 'nano-test-passphrase';
const XNO = 10n ** 30n;
const PAYER_KEY = Buffer.from(blake2b(new Uint8Array(36), { dkLen: 32 }));
const PAYER = keyToAddress(PAYER_KEY);
const PAYEE = keyToAddress(Buffer.from(blake2b(new Uint8Array([...new Uint8Array(32), 0, 0, 0, 1]), { dkLen: 32 })));
const FRONTIER = '2A'.repeat(32);

interface State {
  accepts: Array<Record<string, unknown>>;
  rpcCalls: Array<Record<string, unknown>>;
  paymentHeaders: Array<Record<string, unknown>>;
  merchantHits: number;
  processError?: string;
  dropPaidRequests?: number;
}

let server: Server;
let origin = '';
let state: State;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c: Buffer) => (data += c.toString()));
    req.on('end', () => resolve(data));
  });
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req);
  if (req.url === '/rpc') {
    const call = JSON.parse(body) as Record<string, unknown>;
    state.rpcCalls.push(call);
    if (call.action === 'account_balance') return json(res, 200, { balance: (3n * XNO).toString(), receivable: '0' });
    if (call.action === 'account_info') {
      return json(res, 200, { frontier: FRONTIER, balance: (3n * XNO).toString(), representative: PAYER });
    }
    if (call.action === 'work_generate') return json(res, 200, { work: 'fedcba9876543210' });
    if (call.action === 'process') {
      if (state.processError) return json(res, 200, { error: state.processError });
      return json(res, 200, {});
    }
    return json(res, 200, { error: 'unknown action' });
  }
  state.merchantHits += 1;
  const sig = req.headers['payment-signature'];
  if (typeof sig === 'string') {
    state.paymentHeaders.push(JSON.parse(Buffer.from(sig, 'base64').toString('utf8')) as Record<string, unknown>);
    if (state.dropPaidRequests) {
      state.dropPaidRequests -= 1;
      req.socket.destroy();
      return;
    }
    return json(res, 200, { ok: true, item: 'report' });
  }
  const required = {
    x402Version: 2,
    resource: { url: `${origin}${req.url}`, description: 'report', mimeType: 'application/json' },
    accepts: state.accepts,
  };
  return json(res, 402, {}, { 'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(required)).toString('base64') });
}

function nanoAccept(overrides: Record<string, unknown> = {}) {
  return {
    scheme: 'exact',
    network: 'nano:mainnet',
    asset: 'XNO',
    amount: (XNO / 100n).toString(),
    payTo: PAYEE,
    maxTimeoutSeconds: 60,
    extra: {},
    ...overrides,
  };
}

const baseAccept = {
  scheme: 'exact',
  network: 'eip155:8453',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  amount: '10000000',
  payTo: '0x000000000000000000000000000000000000dEaD',
  maxTimeoutSeconds: 60,
  extra: { name: 'USD Coin', version: '2', decimals: 6 },
};

let home = '';

beforeAll(async () => {
  server = createServer((req, res) => void handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  origin = `http://127.0.0.1:${addr.port}`;
  home = await mkdtemp(join(tmpdir(), 'pay-nano-'));
  process.env.AGENTSCORE_PAY_HOME = home;
  process.env.AGENTSCORE_PAY_PASSPHRASE = PASS;
  await createWallet('nano', PASS, PAYER_KEY);
  await createWallet('base', PASS, Buffer.alloc(32, 1));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.AGENTSCORE_PAY_HOME;
  delete process.env.AGENTSCORE_PAY_PASSPHRASE;
  await rm(home, { recursive: true, force: true });
});

beforeEach(() => {
  state = { accepts: [nanoAccept()], rpcCalls: [], paymentHeaders: [], merchantHits: 0 };
  process.env.NANO_RPC_URL = `${origin}/rpc`;
});

afterEach(() => {
  delete process.env.NANO_RPC_URL;
});

const actions = () => state.rpcCalls.map((c) => c.action);

describe('pay --chain nano (x402 exact on nano:mainnet)', () => {
  it('settles a 402 that offers only nano:mainnet exact', async () => {
    const result = await pay({
      chain: 'nano',
      method: 'POST',
      url: `${origin}/report`,
      body: '{}',
      maxSpendXno: '0.05',
      skipPassport: true,
    });
    expect(result).toMatchObject({ ok: true, status: 200, chain: 'nano', protocol: 'x402', signer: PAYER, price_xno: '0.01' });
    expect(result).not.toHaveProperty('price_usd');
    expect(actions()).toEqual(['account_balance', 'account_info', 'work_generate', 'process']);

    const block = (state.rpcCalls[3] as { block: Record<string, string> }).block;
    expect(block.link).toBe(Buffer.from(addressToPublicKey(PAYEE)).toString('hex').toUpperCase());
    expect(BigInt(block.balance)).toBe(3n * XNO - XNO / 100n);

    expect(state.paymentHeaders).toHaveLength(1);
    expect(state.paymentHeaders[0]).toMatchObject({
      x402Version: 2,
      accepted: { network: 'nano:mainnet', payTo: PAYEE },
      payload: { blockHash: expect.stringMatching(/^[0-9A-F]{64}$/) },
    });

    const ledger = (await readFile(join(home, 'history.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    expect(ledger.at(-1)).toMatchObject({ chain: 'nano', price_xno: '0.01', ok: true });
    expect(ledger.at(-1)).not.toHaveProperty('price_usd');
  });

  it('dry-run reports the XNO balance and cap without touching the merchant', async () => {
    const result = await pay({
      chain: 'nano',
      method: 'POST',
      url: `${origin}/report`,
      maxSpendXno: '0.05',
      skipPassport: true,
      dryRun: true,
    });
    expect(result).toMatchObject({ dry_run: true, selected_chain: 'nano', protocol: 'x402', balance_xno: '3.0', max_spend_xno: '0.05' });
    expect(result).not.toHaveProperty('balance_usdc');
    expect(state.merchantHits).toBe(0);
  });

  it('refuses with limit_required when --max-spend-xno is absent, even with a USD --max-spend', async () => {
    await expect(
      pay({ chain: 'nano', method: 'POST', url: `${origin}/report`, maxSpendUsd: 100, skipPassport: true }),
    ).rejects.toMatchObject({ code: 'limit_required' });
    expect(state.merchantHits).toBe(0);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it('aborts over the XNO cap before any block is built or published', async () => {
    await expect(
      pay({ chain: 'nano', method: 'POST', url: `${origin}/report`, maxSpendXno: '0.001', skipPassport: true }),
    ).rejects.toMatchObject({ code: 'max_spend_exceeded', extra: { chain: 'nano', price_raw: (XNO / 100n).toString() } });
    expect(actions()).toEqual(['account_balance']);
    expect(state.paymentHeaders).toHaveLength(0);
  });

  it('maps a node error on publish to network_error and sends no payment header', async () => {
    state.processError = 'Fork';
    await expect(
      pay({ chain: 'nano', method: 'POST', url: `${origin}/report`, maxSpendXno: '0.05', skipPassport: true }),
    ).rejects.toMatchObject({ code: 'network_error', message: expect.stringContaining('Fork') });
    expect(state.paymentHeaders).toHaveLength(0);
  });

  it('refuses a payTo whose checksum does not match, before publishing', async () => {
    const last = PAYEE.at(-1) === '1' ? '3' : '1';
    state.accepts = [nanoAccept({ payTo: PAYEE.slice(0, -1) + last })];
    await expect(
      pay({ chain: 'nano', method: 'POST', url: `${origin}/report`, maxSpendXno: '0.05', skipPassport: true }),
    ).rejects.toMatchObject({ code: 'invalid_wallet_address' });
    expect(actions()).not.toContain('process');
    expect(state.paymentHeaders).toHaveLength(0);
  });

  it('pays an xrb_ payTo to the same account', async () => {
    state.accepts = [nanoAccept({ payTo: PAYEE.replace(/^nano_/, 'xrb_') })];
    await pay({ chain: 'nano', method: 'POST', url: `${origin}/report`, maxSpendXno: '0.05', skipPassport: true });
    const block = (state.rpcCalls.find((c) => c.action === 'process') as { block: Record<string, string> }).block;
    expect(block.link).toBe(Buffer.from(addressToPublicKey(PAYEE)).toString('hex').toUpperCase());
  });

  it('re-presents the same block when a retry follows a dropped paid request', async () => {
    state.dropPaidRequests = 1;
    const result = await pay({
      chain: 'nano',
      method: 'POST',
      url: `${origin}/report`,
      maxSpendXno: '0.05',
      skipPassport: true,
      retries: 1,
    });
    expect(result).toMatchObject({ ok: true, chain: 'nano' });
    expect(actions().filter((a) => a === 'process')).toHaveLength(1);
    expect(state.paymentHeaders).toHaveLength(2);
    const hashes = state.paymentHeaders.map((p) => (p.payload as { blockHash: string }).blockHash);
    expect(hashes[1]).toBe(hashes[0]);
  });

  it('is mainnet-only', async () => {
    await expect(
      pay({ chain: 'nano', network: 'testnet', method: 'POST', url: `${origin}/report`, maxSpendXno: '0.05', skipPassport: true }),
    ).rejects.toMatchObject({ code: 'invalid_network' });
  });

  it('still picks the Base requirement with --chain base when both rails are offered', async () => {
    state.accepts = [nanoAccept(), baseAccept];
    await expect(
      pay({ chain: 'base', method: 'POST', url: `${origin}/report`, maxSpendUsd: 1, skipPassport: true }),
    ).rejects.toMatchObject({ code: 'max_spend_exceeded', extra: { price_usd: 10, max_spend_usd: 1 } });
    expect(state.rpcCalls).toHaveLength(0);
    expect(state.paymentHeaders).toHaveLength(0);
  });
});
