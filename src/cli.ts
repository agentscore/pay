import { Command, Option } from 'commander';
import { balance } from './commands/balance';
import { fund } from './commands/fund';
import { pay } from './commands/pay';
import { qr } from './commands/qr';
import { walletAddress, walletCreate, walletImport } from './commands/wallet';
import { SUPPORTED_CHAINS, type Chain } from './constants';

declare const __VERSION__: string;

function chainOption(): Option {
  return new Option('--chain <chain>', 'blockchain network').choices([...SUPPORTED_CHAINS]).default('base');
}

function collectHeader(value: string, previous: Record<string, string>): Record<string, string> {
  const idx = value.indexOf(':');
  if (idx < 1) throw new Error(`Invalid -H header (expected 'Name: value'): ${value}`);
  const name = value.slice(0, idx).trim();
  const v = value.slice(idx + 1).trim();
  return { ...previous, [name]: v };
}

export function buildCli(): Command {
  const program = new Command('agentscore-pay')
    .description('CLI wallet for one-shell-command agent payments (x402 on Base + Solana, MPP on Tempo)')
    .version(typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0-dev');

  const wallet = program.command('wallet').description('Manage the local keystore');

  wallet
    .command('create')
    .description('Generate a new encrypted keystore')
    .addOption(chainOption())
    .action(async (opts: { chain: Chain }) => {
      await walletCreate(opts.chain);
    });

  wallet
    .command('import <key>')
    .description('Import a private key (hex for base, base64 keypair for solana)')
    .addOption(chainOption())
    .action(async (key: string, opts: { chain: Chain }) => {
      await walletImport(opts.chain, key);
    });

  wallet
    .command('address')
    .description('Print the wallet address')
    .addOption(chainOption())
    .action(async (opts: { chain: Chain }) => {
      await walletAddress(opts.chain);
    });

  program
    .command('balance')
    .description('Show USDC balance across configured chains')
    .addOption(new Option('--chain <chain>', 'limit to a single chain').choices([...SUPPORTED_CHAINS]))
    .action(async (opts: { chain?: Chain }) => {
      await balance(opts.chain);
    });

  program
    .command('qr')
    .description('Print an ASCII QR for receiving USDC')
    .addOption(chainOption())
    .option('--amount <usd>', 'pre-fill amount in USD', (v) => Number(v))
    .action(async (opts: { chain: Chain; amount?: number }) => {
      await qr(opts.chain, opts.amount);
    });

  program
    .command('fund')
    .description('Print Coinbase Onramp URL + QR, poll balance until deposit lands')
    .addOption(chainOption())
    .option('--amount <usd>', 'target amount in USD', (v) => Number(v))
    .action(async (opts: { chain: Chain; amount?: number }) => {
      await fund(opts.chain, opts.amount);
    });

  program
    .command('pay <method> <url>')
    .description('Send an HTTP request and auto-handle the x402 402 response')
    .addOption(chainOption())
    .option('-d, --data <body>', 'request body')
    .option('-H, --header <header...>', 'additional header (repeatable)', collectHeader, {} as Record<string, string>)
    .option('--max-spend <usd>', 'reject payments above this USD amount', (v) => Number(v))
    .option('-v, --verbose', 'dump request/response metadata to stderr')
    .action(
      async (
        method: string,
        url: string,
        opts: {
          chain: Chain;
          data?: string;
          header?: Record<string, string>;
          maxSpend?: number;
          verbose?: boolean;
        },
      ) => {
        await pay({
          chain: opts.chain,
          method: method.toUpperCase(),
          url,
          body: opts.data,
          headers: opts.header,
          maxSpendUsd: opts.maxSpend,
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
