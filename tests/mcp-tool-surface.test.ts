import { spawn } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The MCP tool surface is generated from the CLI's command definitions, so a
 * new command reaches agents by default. That default is the finding: served as
 * tools, the CLI's safety gates (`--danger`, the typed EXPORT confirm, an
 * interactive passphrase prompt) become boolean parameters the model sets for
 * itself, and anything they guard lands in the transcript and the model
 * provider's logs.
 *
 * This drives a REAL MCP handshake rather than reading the source or the CLI's
 * internals. Two earlier attempts were unsound: grepping for `mcp: false` would
 * pass whether or not the flag reached the tool list, and walking the Cli
 * object does not work because incur builds it as a closure with no command map
 * to inspect. Asking the server is the only check that cannot pass vacuously.
 */

const CWD = new URL('..', import.meta.url).pathname;

interface Rpc { id?: number; result?: { content?: { text?: string }[] }; error?: unknown }

/** Boot the MCP server over stdio and expose a `call` for its meta tools. */
const withServer = async <T>(fn: (call: (tool: string, args: Record<string, unknown>) => Promise<string>) => Promise<T>): Promise<T> => {
  const child = spawn('bun', ['src/index.ts', '--mcp'], { cwd: CWD, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map<number, (m: Rpc) => void>();
  let buf = '';
  let id = 10;
  const send = (o: unknown) => child.stdin.write(`${JSON.stringify(o)}\n`);

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('MCP server did not initialize')), 30_000);
      child.stderr.on('data', () => {});
      child.stdout.on('data', (d: Buffer) => {
        buf += d.toString();
        for (const line of buf.split('\n')) {
          if (!line.trim()) { continue; }
          let m: Rpc;
          try { m = JSON.parse(line) as Rpc; } catch { continue; }
          if (m.id === 1) { clearTimeout(timer); resolve(); }
          const p = m.id === undefined ? undefined : pending.get(m.id);
          if (p) { pending.delete(m.id as number); p(m); }
        }
        buf = buf.slice(buf.lastIndexOf('\n') + 1);
      });
      send({ id: 1, jsonrpc: '2.0', method: 'initialize', params: { capabilities: {}, clientInfo: { name: 'surface-test', version: '1' }, protocolVersion: '2024-11-05' } });
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    const call = (tool: string, args: Record<string, unknown>) =>
      new Promise<string>((resolve, reject) => {
        const i = ++id;
        pending.set(i, (m) => resolve(JSON.stringify(m.result?.content ?? m.error ?? m)));
        setTimeout(() => reject(new Error(`timed out calling ${tool}`)), 25_000);
        send({ id: i, jsonrpc: '2.0', method: 'tools/call', params: { arguments: args, name: tool } });
      });

    return await fn(call);
  } finally {
    child.kill();
  }
};

// Reachable on the CLI, never as an agent tool: each either discloses key
// material or moves funds irreversibly, and the reporter invoked all of these.
const MUST_BE_HIDDEN = ['wallet_export', 'wallet_show-mnemonic', 'wallet_remove', 'send', 'unlock'];

// The paying path the agent fleet actually uses. Pinned alongside the
// exclusions so a future tightening cannot quietly take the fleet's tools away.
const MUST_STAY_EXPOSED = ['pay', 'balance'];

describe('MCP tool surface', () => {
  let details: Record<string, string> = {};

  beforeAll(async () => {
    details = await withServer(async (call) => {
      const out: Record<string, string> = {};
      for (const t of [...MUST_BE_HIDDEN, ...MUST_STAY_EXPOSED]) {
        out[t] = await call('get_tool_details', { name: t });
      }
      return out;
    });
  }, 60_000);

  // Positive control: if the handshake silently returned nothing, every
  // "unknown tool" assertion below would pass for the wrong reason.
  it('reaches a live server that answers about a tool it does expose', () => {
    expect(details.pay, 'no answer for `pay`; did the handshake work?').toBeTruthy();
    expect(details.pay).not.toContain('Unknown tool');
  });

  it.each(MUST_BE_HIDDEN)('does not expose %s to MCP clients', (tool) => {
    expect(details[tool], `${tool} is still reachable as an MCP tool`).toContain('Unknown tool');
  });

  it.each(MUST_STAY_EXPOSED)('still exposes %s', (tool) => {
    expect(details[tool], `${tool} must stay available to agents`).not.toContain('Unknown tool');
  });
});
