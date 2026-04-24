import { Command, Option } from 'commander';
import { balance } from './commands/balance';
import { check } from './commands/check';
import { fund } from './commands/fund';
import { history } from './commands/history';
import { limitsClear, limitsSet, limitsShow } from './commands/limits';
import { pay } from './commands/pay';
import { qr } from './commands/qr';
import { walletAddress, walletCreate, walletExport, walletImport } from './commands/wallet';
import { whoami } from './commands/whoami';
import { SUPPORTED_CHAINS, type Chain } from './constants';
import { resolveMode, setMode } from './output';
import type { ModeFlags } from './output';

declare const __VERSION__: string;

type GlobalOpts = { json?: boolean; plain?: boolean };

function chainOption(required = false): Option {
  const opt = new Option('--chain <chain>', 'blockchain network').choices([...SUPPORTED_CHAINS]);
  return required ? opt.makeOptionMandatory() : opt;
}

function collectHeader(value: string, previous: Record<string, string>): Record<string, string> {
  const idx = value.indexOf(':');
  if (idx < 1) throw new Error(`Invalid -H header (expected 'Name: value'): ${value}`);
  const name = value.slice(0, idx).trim();
  const v = value.slice(idx + 1).trim();
  return { ...previous, [name]: v };
}

function applyMode(program: Command): ModeFlags {
  const globalOpts = program.opts() as GlobalOpts;
  const flags: ModeFlags = { json: globalOpts.json, plain: globalOpts.plain };
  setMode(resolveMode(flags));
  return flags;
}

const HELP_FOOTER = `
Exit codes:
  0  success
  1  user error (bad args, missing wallet, wrong passphrase)
  2  network error (merchant unreachable, RPC failure)
  3  insufficient funds
  4  payment rejected (exceeds --max-spend, signer mismatch)
  5  multi-rail ambiguity (requires --chain or preferred_chains config)

Environment:
  AGENTSCORE_PAY_PASSPHRASE   skip interactive passphrase prompt
  BASE_RPC_URL                override Base mainnet RPC endpoint
  SOLANA_RPC_URL              override Solana mainnet RPC endpoint
  TEMPO_RPC_URL               override Tempo mainnet RPC endpoint

Config:
  ~/.agentscore/config.json   { "preferred_chains": ["base", "tempo"] }
`;

export function buildCli(): Command {
  const program = new Command('agentscore-pay')
    .description('CLI wallet for one-shell-command agent payments (x402 on Base + Solana, MPP on Tempo)')
    .version(typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0-dev')
    .option('--json', 'emit machine-readable JSON on stdout (errors JSON on stderr)')
    .option('--plain', 'disable color and interactive prompts (auto when not a TTY)')
    .addHelpText('after', HELP_FOOTER);

  const wallet = program
    .command('wallet')
    .description('Manage the local encrypted keystore');

  wallet
    .command('create')
    .description('Generate a new encrypted keystore. Omit --chain to create all three chains.')
    .addOption(chainOption())
    .addHelpText(
      'after',
      '\nExamples:\n  agentscore-pay wallet create                 # creates base, solana, tempo\n  agentscore-pay wallet create --chain base    # creates just base\n  AGENTSCORE_PAY_PASSPHRASE=... agentscore-pay wallet create --json  # scripted\n',
    )
    .action(async (opts: { chain?: Chain }) => {
      applyMode(program);
      await walletCreate(opts.chain);
    });

  wallet
    .command('import <key>')
    .description('Import an existing key (hex for EVM, base64 for Solana private-key seed)')
    .addOption(chainOption(true))
    .action(async (key: string, opts: { chain: Chain }) => {
      applyMode(program);
      await walletImport(opts.chain, key);
    });

  wallet
    .command('address')
    .description('Print a wallet address')
    .addOption(chainOption(true))
    .action(async (opts: { chain: Chain }) => {
      applyMode(program);
      await walletAddress(opts.chain);
    });

  wallet
    .command('export')
    .description('Decrypt and print a private key. DANGER — only run if you trust the surrounding environment.')
    .addOption(chainOption(true))
    .option('--danger', 'explicitly acknowledge the risk of printing a private key')
    .option('--skip-confirm', 'skip the "type EXPORT" prompt (for scripting)')
    .action(async (opts: { chain: Chain; danger?: boolean; skipConfirm?: boolean }) => {
      applyMode(program);
      await walletExport(opts);
    });

  program
    .command('balance')
    .description('Show USDC balance across configured chains')
    .addOption(chainOption())
    .action(async (opts: { chain?: Chain }) => {
      applyMode(program);
      await balance(opts.chain);
    });

  program
    .command('qr')
    .description('Print an ASCII QR for receiving USDC (raw address or EIP-681 / solana: URI when --amount)')
    .addOption(chainOption(true))
    .option('--amount <usd>', 'pre-fill amount in USD', (v) => Number(v))
    .action(async (opts: { chain: Chain; amount?: number }) => {
      applyMode(program);
      await qr(opts.chain, opts.amount);
    });

  program
    .command('fund')
    .description('Print Coinbase Onramp URL + QR, poll balance until deposit lands (Tempo: hints tempo wallet fund)')
    .addOption(chainOption(true))
    .option('--amount <usd>', 'target amount in USD', (v) => Number(v))
    .action(async (opts: { chain: Chain; amount?: number }) => {
      applyMode(program);
      await fund(opts.chain, opts.amount);
    });

  const limits = program.command('limits').description('Persistent local spending allowances (per-call, daily, per-merchant)');
  limits
    .command('show', { isDefault: true })
    .description('Print current limits (read from ~/.agentscore/limits.json)')
    .action(async () => {
      applyMode(program);
      await limitsShow();
    });
  limits
    .command('set')
    .description('Set one or more limits (USD). Merges with existing limits.')
    .option('--daily <usd>', 'maximum USD spent across all merchants in a rolling 24h window', (v) => Number(v))
    .option('--per-call <usd>', 'maximum USD on a single pay call', (v) => Number(v))
    .option('--per-merchant <usd>', 'maximum USD per merchant (by host) across all history', (v) => Number(v))
    .action(async (opts: { daily?: number; perCall?: number; perMerchant?: number }) => {
      applyMode(program);
      await limitsSet(opts);
    });
  limits
    .command('clear')
    .description('Remove ~/.agentscore/limits.json')
    .action(async () => {
      applyMode(program);
      await limitsClear();
    });

  program
    .command('history')
    .description('Show recent payments (reads ~/.agentscore/history.jsonl)')
    .option('--limit <n>', 'max rows to show (default: all)', (v) => Number(v))
    .action(async (opts: { limit?: number }) => {
      applyMode(program);
      await history({ limit: opts.limit });
    });

  program
    .command('whoami')
    .description('Show wallets + balances across chains + active config preferences')
    .action(async () => {
      applyMode(program);
      await whoami();
    });

  program
    .command('check <url>')
    .description('Probe a URL for a 402 response and show accepted rails without paying')
    .option('-X, --method <method>', 'HTTP method', 'GET')
    .option('-d, --data <body>', 'request body')
    .option('-H, --header <header...>', "additional header (repeatable, 'Name: value')", collectHeader, {} as Record<string, string>)
    .action(
      async (
        url: string,
        opts: { method: string; data?: string; header?: Record<string, string> },
      ) => {
        applyMode(program);
        await check({ method: opts.method.toUpperCase(), url, body: opts.data, headers: opts.header });
      },
    );

  program
    .command('pay <method> <url>')
    .description('Send an HTTP request and auto-handle the 402 payment round-trip')
    .addOption(chainOption())
    .option('-d, --data <body>', 'request body')
    .option('-H, --header <header...>', "additional header (repeatable, 'Name: value')", collectHeader, {} as Record<string, string>)
    .option('--max-spend <usd>', 'reject payments above this USD amount', (v) => Number(v))
    .option('--dry-run', 'print the payment plan without signing or sending')
    .option('-v, --verbose', 'log rail selection + balances to stderr')
    .addHelpText(
      'after',
      '\nExamples:\n  agentscore-pay pay POST https://merchant.example/x -d \'{}\' --max-spend 5\n  agentscore-pay pay POST https://merchant.example/x --chain tempo -d \'{}\' --max-spend 5\n  agentscore-pay pay GET https://merchant.example/y --json   # scripted\n\nRail selection:\n  1. --chain X                                → use X (error if not accepted or insufficient)\n  2. ~/.agentscore/config.json preferred_chains → use first matching candidate\n  3. exactly one funded candidate             → use it\n  4. zero candidates                          → error (fund something)\n  5. multiple candidates                      → error, require --chain\n',
    )
    .action(
      async (
        method: string,
        url: string,
        opts: {
          chain?: Chain;
          data?: string;
          header?: Record<string, string>;
          maxSpend?: number;
          dryRun?: boolean;
          verbose?: boolean;
        },
      ) => {
        applyMode(program);
        await pay({
          chain: opts.chain,
          method: method.toUpperCase(),
          url,
          body: opts.data,
          headers: opts.header,
          maxSpendUsd: opts.maxSpend,
          dryRun: opts.dryRun,
          verbose: opts.verbose,
        });
      },
    );

  return program;
}

export async function run(argv: readonly string[]): Promise<void> {
  const program = buildCli();
  await program.parseAsync([...argv]);
}
