import { Cli, Errors, z } from 'incur';
import { agentGuide } from './commands/agent-guide';
import { balance } from './commands/balance';
import { check } from './commands/check';
import { configGet, configPathCmd, configSet, configUnset } from './commands/config';
import { discover } from './commands/discover';
import { faucet } from './commands/faucet';
import { fund } from './commands/fund';
import { fundEstimate } from './commands/fund-estimate';
import { history } from './commands/history';
import {
  assess,
  associateWallet,
  credentialCreate,
  credentialList,
  credentialRevoke,
  reputation,
  sessionCreate,
  sessionGet,
} from './commands/identity';
import { init } from './commands/init';
import { limitsClear, limitsSet, limitsShow } from './commands/limits';
import {
  passportLoginCommand,
  passportLogoutCommand,
  passportStatusCommand,
} from './commands/passport';
import { pay } from './commands/pay';
import { qr } from './commands/qr';
import { revoke } from './commands/revoke';
import { unlock } from './commands/unlock';
import {
  walletAddress,
  walletCreate,
  walletExport,
  walletImport,
  walletImportMnemonic,
  walletList,
  walletRemove,
  walletShowMnemonic,
} from './commands/wallet';
import { whoami } from './commands/whoami';
import { SUPPORTED_CHAINS, SUPPORTED_NETWORKS } from './constants';
import { CliError, exitCodeForError } from './errors';

declare const __VERSION__: string;

const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0-dev';

const chainSchema = z.enum(SUPPORTED_CHAINS).describe('Blockchain rail (base, solana, tempo)');
const networkSchema = z.enum(SUPPORTED_NETWORKS).default('mainnet').describe('Mainnet (default) or testnet');
const walletNameSchema = z.string().default('default').describe('Named keystore — pass a name to use a non-default wallet');

function parseHeaders(values: string[] | undefined): Record<string, string> | undefined {
  if (!values || values.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const v of values) {
    const idx = v.indexOf(':');
    if (idx < 1) throw new CliError('invalid_input', `Invalid -H header (expected 'Name: value'): ${v}`);
    out[v.slice(0, idx).trim()] = v.slice(idx + 1).trim();
  }
  return out;
}

/**
 * Wrap a command handler so any thrown CliError becomes incur's IncurError, which
 * carries the structured code, message, hint, retryable flag, and exit code through
 * to incur's error envelope (and the MCP / --json / human renderers).
 */
function withCliErrors<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err: unknown) => {
    if (err instanceof CliError) {
      throw new Errors.IncurError({
        code: err.code,
        message: err.message,
        exitCode: exitCodeForError(err.code),
        hint: err.nextSteps?.suggestion,
        retryable: err.code === 'network_error' || err.code === 'rpc_error' || err.code === 'session_timeout',
      });
    }
    throw err;
  });
}

export function buildCli() {
  const cli = Cli.create('agentscore-pay', {
    description:
      'CLI wallet for one-shell-command agent payments (x402 on Base + Solana, MPP on Tempo). Built by AgentScore; works with any 402-gated merchant.',
    version: VERSION,
    env: z.object({
      AGENTSCORE_API_KEY: z.string().optional().describe('API key for paid-tier identity tools (assess, sessions, credentials, associate-wallet, reputation). Not required for passport login/status — those use the public session endpoint.'),
      AGENTSCORE_PAY_PASSPHRASE: z.string().optional().describe('Skip the interactive passphrase prompt for keystore operations'),
      AGENTSCORE_PAY_HOME: z.string().optional().describe('Override the state dir (default: ~/.agentscore)'),
      BASE_RPC_URL: z.string().optional().describe('Override Base mainnet RPC endpoint'),
      BASE_SEPOLIA_RPC_URL: z.string().optional().describe('Override Base Sepolia RPC endpoint'),
      SOLANA_RPC_URL: z.string().optional().describe('Override Solana mainnet RPC endpoint'),
      SOLANA_DEVNET_RPC_URL: z.string().optional().describe('Override Solana Devnet RPC endpoint'),
      TEMPO_RPC_URL: z.string().optional().describe('Override Tempo mainnet RPC endpoint'),
      TEMPO_TESTNET_RPC_URL: z.string().optional().describe('Override Tempo testnet RPC endpoint'),
    }),
    sync: {
      suggestions: [
        'create a wallet on every supported chain with `agentscore-pay init`',
        'discover paid services with `agentscore-pay discover --search <query>`',
        'probe a 402 endpoint with `agentscore-pay check <url> -X POST -d <body>`',
        'pay an endpoint with `agentscore-pay pay POST <url> -d <body> --max-spend 5`',
        'verify your AgentScore Passport once with `agentscore-pay passport login` — pay then auto-attaches X-Operator-Token to every gated merchant',
        'check trust reputation for a wallet with `agentscore-pay reputation <address>`',
      ],
    },
  });

  // ── init ────────────────────────────────────────────────────────────────────
  cli.command('init', {
    description:
      'One-shot first-run: creates all 3 wallets (mnemonic by default), optional testnet fund + preferred-chain config',
    hint: 'Set AGENTSCORE_PAY_PASSPHRASE to skip the interactive passphrase prompt during scripted runs.',
    options: z.object({
      mnemonic: z.boolean().default(true).describe('Derive keys from a single BIP-39 phrase (default: true; pass --no-mnemonic for raw keys)'),
      fundTempoTestnet: z.boolean().optional().describe('After creating wallets, mint Tempo testnet stablecoins'),
      preferredChains: z.string().optional().describe('Comma-separated chain order for rail tiebreaking (e.g. tempo,base)'),
    }),
    examples: [
      { description: 'Create all 3 wallets from a single BIP-39 mnemonic' },
      { options: { mnemonic: false }, description: 'Create raw keys per chain (no mnemonic)' },
      { options: { fundTempoTestnet: true }, description: 'Create wallets and auto-fund Tempo testnet' },
      { options: { preferredChains: 'tempo,base' }, description: 'Set rail-selection preference' },
    ],
    run(c) {
      return withCliErrors(async () => {
        const result = await init({
          mnemonic: c.options.mnemonic,
          fundTempoTestnet: c.options.fundTempoTestnet,
          preferredChains: c.options.preferredChains,
        });
        return c.ok(result, {
          cta: {
            description: 'Next steps:',
            commands: [
              { command: 'fund', options: { chain: true }, description: 'Top up a wallet via Coinbase Onramp + QR' },
              { command: 'balance', description: 'Confirm wallet balances' },
              { command: 'discover', description: 'Browse paid services in the x402 + MPP ecosystem' },
            ],
          },
        });
      });
    },
  });

  // ── wallet group ────────────────────────────────────────────────────────────
  const wallet = Cli.create('wallet', { description: 'Manage the local encrypted keystore' });

  wallet.command('create', {
    description: 'Generate a new encrypted keystore. Omit --chain to create all three chains.',
    options: z.object({
      chain: chainSchema.optional().describe('Blockchain rail (base, solana, tempo)'),
      wallet: walletNameSchema,
      mnemonic: z.boolean().optional().describe('Generate a BIP-39 mnemonic and derive keys from it'),
    }),
    examples: [
      { description: 'Create base, solana, tempo wallets (random keys per chain)' },
      { options: { chain: 'base' }, description: 'Create only the base wallet' },
      { options: { mnemonic: true }, description: 'Generate a BIP-39 mnemonic and derive all three chains' },
      { options: { chain: 'base', wallet: 'trading' }, description: 'Create a named secondary wallet' },
    ],
    run({ options }) {
      return withCliErrors(() =>
        walletCreate({ chain: options.chain, mnemonic: options.mnemonic, name: options.wallet }),
      );
    },
  });

  wallet.command('import', {
    description: 'Import a key. Use either <key> positional (hex/base64) or --mnemonic to import a BIP-39 phrase.',
    args: z.object({
      key: z.string().optional().describe('Hex private key (EVM) or base64 private-key seed (Solana)'),
    }),
    options: z.object({
      chain: chainSchema.optional().describe('Blockchain rail (base, solana, tempo)'),
      wallet: walletNameSchema,
      mnemonic: z.string().optional().describe('BIP-39 mnemonic phrase (12 or 24 words, quoted)'),
    }),
    examples: [
      { args: { key: '0xYOUR_PRIVATE_KEY' }, options: { chain: 'base' }, description: 'Import an EVM private key (replace 0xYOUR_PRIVATE_KEY)' },
      { options: { mnemonic: "'twelve or twenty-four word phrase here'" }, description: 'Import a BIP-39 mnemonic — quote it (derives all three chains)' },
    ],
    run({ args, options }) {
      return withCliErrors(async () => {
        if (options.mnemonic) {
          if (options.wallet !== 'default') {
            throw new CliError(
              'invalid_input',
              '--mnemonic stores keys under the "default" wallet name; --wallet is not supported in this mode.',
            );
          }
          return walletImportMnemonic({ phrase: options.mnemonic, chain: options.chain });
        }
        if (!args.key) throw new CliError('invalid_input', 'Pass either <key> positional or --mnemonic <phrase>');
        if (!options.chain) throw new CliError('invalid_input', '--chain is required when importing a raw key');
        return walletImport({ chain: options.chain, key: args.key, name: options.wallet });
      });
    },
  });

  wallet.command('list', {
    description: 'List all named keystores per chain',
    options: z.object({ chain: chainSchema.optional().describe('Filter to one chain') }),
    examples: [
      { description: 'List every named wallet across all chains' },
      { options: { chain: 'base' }, description: 'List only base wallets' },
    ],
    run({ options }) {
      return withCliErrors(() => walletList({ chain: options.chain }));
    },
  });

  wallet.command('show-mnemonic', {
    description: 'Print the stored BIP-39 mnemonic. DANGER — only run in a trusted environment.',
    hint: 'The mnemonic restores every chain wallet — anyone with this phrase can drain your funds. Never paste it into chat, logs, or unencrypted storage.',
    outputPolicy: 'agent-only',
    options: z.object({
      danger: z.boolean().optional().describe('Acknowledge the risk of printing the mnemonic'),
      skipConfirm: z.boolean().optional().describe('Skip the type-EXPORT prompt (for scripting)'),
    }),
    run({ options }) {
      return withCliErrors(() =>
        walletShowMnemonic({ danger: options.danger, skipConfirm: options.skipConfirm }),
      );
    },
  });

  wallet.command('address', {
    description: 'Print a wallet address',
    options: z.object({
      chain: chainSchema,
      wallet: walletNameSchema,
    }),
    examples: [
      { options: { chain: 'base' }, description: 'Print the default base address' },
      { options: { chain: 'solana', wallet: 'trading' }, description: 'Print a named wallet address' },
    ],
    run({ options }) {
      return withCliErrors(() => walletAddress({ chain: options.chain, name: options.wallet }));
    },
  });

  wallet.command('export', {
    description: 'Decrypt and print a private key. DANGER — only run if you trust the surrounding environment.',
    hint: 'The exported key gives full control of the wallet to anyone who reads it. Pipe to an encrypted store; never to a shared shell history.',
    outputPolicy: 'agent-only',
    options: z.object({
      chain: chainSchema,
      wallet: walletNameSchema,
      danger: z.boolean().optional().describe('Acknowledge the risk of this destructive operation'),
      skipConfirm: z.boolean().optional().describe('Skip the type-EXPORT prompt (for scripting)'),
    }),
    run({ options }) {
      return withCliErrors(() =>
        walletExport({
          chain: options.chain,
          name: options.wallet,
          danger: options.danger,
          skipConfirm: options.skipConfirm,
        }),
      );
    },
  });

  wallet.command('remove', {
    description: 'Delete a keystore. DANGER — irrecoverable unless you have the BIP-39 mnemonic backup.',
    hint: 'No undo. Run `wallet show-mnemonic --danger` first if you want to be able to restore.',
    options: z.object({
      chain: chainSchema,
      wallet: walletNameSchema,
      danger: z.boolean().optional().describe('Acknowledge the risk of this destructive operation'),
      skipConfirm: z.boolean().optional().describe('Skip the type-EXPORT prompt (for scripting)'),
    }),
    run({ options }) {
      return withCliErrors(() =>
        walletRemove({
          chain: options.chain,
          name: options.wallet,
          danger: options.danger,
          skipConfirm: options.skipConfirm,
        }),
      );
    },
  });

  cli.command(wallet);

  // ── balance ─────────────────────────────────────────────────────────────────
  cli.command('balance', {
    description: 'Show USDC balance across configured chains',
    options: z.object({
      chain: chainSchema.optional().describe('Blockchain rail (base, solana, tempo)'),
      network: networkSchema,
      wallet: walletNameSchema,
    }),
    examples: [
      { description: 'USDC balance across base, solana, tempo (mainnet)' },
      { options: { network: 'testnet' }, description: 'Testnet balances (Base Sepolia / Solana devnet / Tempo testnet)' },
      { options: { chain: 'tempo' }, description: 'Only the tempo balance' },
    ],
    run({ options }) {
      return withCliErrors(() =>
        balance({ chain: options.chain, network: options.network, name: options.wallet }),
      );
    },
  });

  // ── qr ──────────────────────────────────────────────────────────────────────
  cli.command('qr', {
    description: 'Print an ASCII QR for receiving USDC (raw address or EIP-681 / solana: URI when --amount)',
    options: z.object({
      chain: chainSchema,
      network: networkSchema,
      wallet: walletNameSchema,
      amount: z.coerce.number().optional().describe('Pre-fill amount in USD'),
    }),
    examples: [
      { options: { chain: 'base' }, description: 'QR for receiving any amount on base' },
      { options: { chain: 'solana', amount: 5 }, description: 'QR pre-filled with $5 USDC on Solana' },
    ],
    run({ options }) {
      return withCliErrors(() =>
        qr({
          chain: options.chain,
          amountUsd: options.amount,
          network: options.network,
          name: options.wallet,
        }),
      );
    },
  });

  // ── fund ────────────────────────────────────────────────────────────────────
  cli.command('fund', {
    description:
      'Fund the wallet. Base/Solana mainnet: Coinbase Onramp URL + receive QR + balance polling. Tempo testnet: programmatic mint via tempo_fundAddress (free, no signup). Tempo mainnet: receive QR + balance polling.',
    hint: 'Tempo testnet funds instantly via JSON-RPC — no browser required. Other networks open Coinbase Onramp in your browser.',
    options: z.object({
      chain: chainSchema,
      network: networkSchema,
      wallet: walletNameSchema,
      amount: z.coerce.number().optional().describe('Target amount in USD (default 10)'),
    }),
    examples: [
      { options: { chain: 'base', amount: 10 }, description: 'Fund $10 USDC on Base via Coinbase Onramp' },
      { options: { chain: 'tempo', network: 'testnet' }, description: 'Programmatically mint Tempo testnet stablecoins (free)' },
    ],
    run(c) {
      return withCliErrors(async () => {
        const result = await fund({
          chain: c.options.chain,
          amountUsd: c.options.amount ?? 10,
          network: c.options.network,
          name: c.options.wallet,
        });
        return c.ok(result, {
          cta: {
            description: 'Next steps:',
            commands: [
              { command: 'balance', description: 'Confirm the deposit landed' },
              { command: 'check', description: 'Probe a paid endpoint to see what your balance covers' },
            ],
          },
        });
      });
    },
  });

  // ── faucet ──────────────────────────────────────────────────────────────────
  cli.command('faucet', {
    description: 'Print the testnet faucet URL for this chain + your address (copies address to clipboard)',
    options: z.object({
      chain: chainSchema,
      network: z.enum(['testnet']).default('testnet').describe('Faucets only exist on testnets'),
    }),
    examples: [
      { options: { chain: 'base' }, description: 'Print Circle / Coinbase Sepolia faucet URLs' },
      { options: { chain: 'tempo' }, description: 'Print the Tempo testnet faucet hint (use `fund` for instant mint)' },
    ],
    run(c) {
      return withCliErrors(async () => {
        const result = await faucet({ chain: c.options.chain, network: c.options.network });
        return c.ok(result, {
          cta: {
            description: 'Next steps:',
            commands: [
              { command: 'fund', options: { chain: true, network: true }, description: 'Mint testnet tokens (Tempo) or open the faucet URL (Base/Solana)' },
              { command: 'balance', options: { network: true }, description: 'Confirm the deposit landed' },
            ],
          },
        });
      });
    },
  });

  // ── fund-estimate ───────────────────────────────────────────────────────────
  cli.command('fund-estimate', {
    description: 'Probe a 402-gated URL and report how many calls your balance covers (plus a top-up suggestion)',
    args: z.object({ url: z.string().describe('URL to probe') }),
    options: z.object({
      chain: chainSchema.optional().describe('Blockchain rail (base, solana, tempo)'),
      network: networkSchema,
      method: z.string().default('GET').describe('HTTP method'),
      data: z.string().optional().describe('Request body'),
      header: z.array(z.string()).optional().describe("Additional header (repeatable, 'Name: value')"),
    }),
    alias: { method: 'X', data: 'd', header: 'H' },
    examples: [
      { args: { url: 'https://merchant.example/api' }, description: 'GET probe — assumes the merchant gates GET requests' },
      { args: { url: 'https://merchant.example/api' }, options: { method: 'POST', data: "'{}'" }, description: 'POST probe with body (quote the JSON)' },
    ],
    run({ args, options }) {
      return withCliErrors(() =>
        fundEstimate({
          url: args.url,
          method: options.method.toUpperCase(),
          body: options.data,
          headers: parseHeaders(options.header),
          chain: options.chain,
          network: options.network,
        }),
      );
    },
  });

  // ── revoke ──────────────────────────────────────────────────────────────────
  cli.command('revoke', {
    description: 'Revoke an ERC-20 allowance: approve(spender, 0). EVM only (base, tempo).',
    hint: 'Requires native gas in the signer wallet (ETH on Base, native token on Tempo).',
    options: z.object({
      chain: chainSchema,
      network: networkSchema,
      wallet: walletNameSchema,
      token: z.string().describe('ERC-20 token contract (0x...)'),
      spender: z.string().describe('Spender to revoke (0x...)'),
    }),
    examples: [
      { options: { chain: 'base', token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', spender: '0xfacilitator' }, description: 'Revoke a USDC allowance on Base' },
    ],
    run({ options }) {
      return withCliErrors(() =>
        revoke({
          chain: options.chain,
          network: options.network,
          token: options.token,
          spender: options.spender,
          name: options.wallet,
        }),
      );
    },
  });

  // ── unlock ──────────────────────────────────────────────────────────────────
  cli.command('unlock', {
    description: 'Cache the wallet passphrase to ~/.agentscore/.unlock for a bounded duration',
    hint: 'Prefer AGENTSCORE_PAY_PASSPHRASE in env when running unattended — it leaves no on-disk artifact.',
    options: z.object({
      for: z.string().default('15m').describe('TTL — e.g. 15m, 2h, 30s, 1d (max 8h)'),
      clear: z.boolean().optional().describe('Remove the cached passphrase'),
    }),
    examples: [
      { options: { for: '1h' }, description: 'Cache the passphrase for one hour' },
      { options: { clear: true }, description: 'Wipe the cached passphrase early' },
    ],
    run({ options }) {
      return withCliErrors(() => unlock({ forDuration: options.for, clear: options.clear }));
    },
  });

  // ── discover ────────────────────────────────────────────────────────────────
  cli.command('discover', {
    description:
      'List paid services from the x402 Bazaar (Coinbase) and MPP services directory (Tempo). Both queried in parallel by default.',
    options: z.object({
      search: z.string().optional().describe('Filter by description / URL / domain / category'),
      chain: chainSchema.optional().describe('Blockchain rail (base, solana, tempo)'),
      maxPrice: z.coerce.number().optional().describe('Only services priced at or below this USD amount'),
      limit: z.coerce.number().optional().describe('Max services to print (default: all)'),
      protocol: z.enum(['x402', 'mpp', 'both']).default('both').describe('Restrict source to one registry'),
    }),
    examples: [
      { options: { limit: 10 }, description: 'Show 10 paid services across both registries' },
      { options: { search: 'search', maxPrice: 0.05 }, description: 'Find search APIs at most $0.05 per call' },
      { options: { chain: 'tempo', protocol: 'mpp' }, description: 'Tempo-only services from the MPP registry' },
    ],
    run({ options }) {
      return withCliErrors(() =>
        discover({
          search: options.search,
          chain: options.chain,
          maxPriceUsd: options.maxPrice,
          limit: options.limit,
          protocol: options.protocol,
        }),
      );
    },
  });

  // ── config group ────────────────────────────────────────────────────────────
  const config = Cli.create('config', {
    description: 'Read/write persistent CLI preferences (~/.agentscore/config.json)',
  });
  config.command('get', {
    description: 'Print a single key (or all keys when omitted)',
    args: z.object({ key: z.string().optional() }),
    examples: [
      { description: 'Print the entire config + valid keys' },
      { args: { key: 'preferred_chains' }, description: 'Print one key' },
    ],
    run({ args }) {
      return withCliErrors(() => configGet({ key: args.key }));
    },
  });
  config.command('set', {
    description: 'Set a config key. Use comma-separated values for list keys (e.g. preferred_chains tempo,base)',
    args: z.object({
      key: z.string(),
      value: z.string(),
    }),
    examples: [
      { args: { key: 'preferred_chains', value: 'tempo,base' }, description: 'Prefer tempo over base for rail tiebreaks' },
    ],
    run({ args }) {
      return withCliErrors(() => configSet({ key: args.key, value: args.value }));
    },
  });
  config.command('unset', {
    description: 'Remove a config key',
    args: z.object({ key: z.string() }),
    run({ args }) {
      return withCliErrors(() => configUnset({ key: args.key }));
    },
  });
  config.command('path', {
    description: 'Print the resolved config file path',
    run() {
      return withCliErrors(() => configPathCmd());
    },
  });
  cli.command(config);

  // ── limits group ────────────────────────────────────────────────────────────
  const limits = Cli.create('limits', {
    description: 'Persistent local spending allowances (per-call, daily, per-merchant)',
  });
  limits.command('show', {
    description: 'Print current limits (read from ~/.agentscore/limits.json)',
    run() {
      return withCliErrors(() => limitsShow());
    },
  });
  limits.command('set', {
    description: 'Set one or more limits (USD). Merges with existing limits.',
    options: z.object({
      daily: z.coerce.number().optional().describe('Maximum USD spent across all merchants in a rolling 24h window'),
      perCall: z.coerce.number().optional().describe('Maximum USD on a single pay call'),
      perMerchant: z.coerce.number().optional().describe('Maximum USD per merchant (by host) across all history'),
    }),
    examples: [
      { options: { daily: 5, perCall: 0.5 }, description: 'Cap daily spend at $5 and per-call at $0.50' },
      { options: { perMerchant: 10 }, description: 'Add a per-merchant ceiling without touching daily/per-call' },
    ],
    run({ options }) {
      return withCliErrors(() =>
        limitsSet({ daily: options.daily, perCall: options.perCall, perMerchant: options.perMerchant }),
      );
    },
  });
  limits.command('clear', {
    description: 'Remove ~/.agentscore/limits.json',
    run() {
      return withCliErrors(() => limitsClear());
    },
  });
  cli.command(limits);

  // ── history ─────────────────────────────────────────────────────────────────
  cli.command('history', {
    description: 'Show recent payments (reads ~/.agentscore/history.jsonl)',
    options: z.object({
      limit: z.coerce.number().optional().describe('Max rows to show (default: all)'),
    }),
    examples: [
      { options: { limit: 20 }, description: 'Show the last 20 payments' },
    ],
    run({ options }) {
      return withCliErrors(() => history({ limit: options.limit }));
    },
  });

  // ── whoami ──────────────────────────────────────────────────────────────────
  cli.command('whoami', {
    description: 'Show wallets + balances across chains + active config preferences',
    options: z.object({ network: networkSchema }),
    examples: [
      { description: 'Mainnet wallet + balance + config summary' },
      { options: { network: 'testnet' }, description: 'Testnet view' },
    ],
    run({ options }) {
      return withCliErrors(() => whoami({ network: options.network }));
    },
  });

  // ── check ───────────────────────────────────────────────────────────────────
  cli.command('check', {
    description: 'Probe a URL for a 402 response and show accepted rails without paying',
    hint: 'Always probe with the same method + body you intend to pay with — most paid endpoints only respond 402 to POST + JSON.',
    args: z.object({ url: z.string() }),
    options: z.object({
      method: z.string().default('GET').describe('HTTP method'),
      data: z.string().optional().describe('Request body — quote JSON values, e.g. -d \'{"k":"v"}\''),
      header: z.array(z.string()).optional().describe("Additional header (repeatable, 'Name: value')"),
    }),
    alias: { method: 'X', data: 'd', header: 'H' },
    examples: [
      { args: { url: 'https://merchant.example/api' }, description: 'GET probe' },
      { args: { url: 'https://merchant.example/api' }, options: { method: 'POST', data: "'{}'" }, description: 'POST probe with body (quote the JSON)' },
    ],
    run(c) {
      return withCliErrors(async () => {
        const result = await check({
          method: c.options.method.toUpperCase(),
          url: c.args.url,
          body: c.options.data,
          headers: parseHeaders(c.options.header),
        });
        if (!result.payment_required) return c.ok(result);
        return c.ok(result, {
          cta: {
            description: 'Next steps:',
            commands: [
              { command: 'pay', description: 'Pay the endpoint (preview first with --dry-run)' },
              { command: 'fund-estimate', description: 'See how many calls your balance covers' },
            ],
          },
        });
      });
    },
  });

  // ── pay ─────────────────────────────────────────────────────────────────────
  cli.command('pay', {
    description: 'Send an HTTP request and auto-handle the 402 payment round-trip',
    hint: 'ALWAYS pass --max-spend with a USD ceiling. Run with --dry-run first to confirm rail + cost.',
    args: z.object({
      method: z.string().describe('HTTP method'),
      url: z.string().describe('URL to pay'),
    }),
    options: z.object({
      chain: chainSchema.optional().describe('Blockchain rail (base, solana, tempo)'),
      network: networkSchema,
      wallet: walletNameSchema,
      data: z.string().optional().describe('Request body'),
      header: z.array(z.string()).optional().describe("Additional header (repeatable, 'Name: value')"),
      maxSpend: z.coerce.number().optional().describe('Reject payments above this USD amount'),
      timeout: z.coerce.number().optional().describe('Abort the merchant request if it takes longer than N seconds'),
      retries: z.coerce.number().optional().describe('Retry transient network errors up to N times'),
      dryRun: z.boolean().optional().describe('Print the payment plan without signing or sending'),
      verbose: z.boolean().optional().describe('Log rail selection + balances to stderr'),
      noPassport: z.boolean().optional().describe('Skip auto-attach of stored AgentScore Passport (X-Operator-Token)'),
    }),
    alias: { data: 'd', header: 'H', verbose: 'v' },
    examples: [
      {
        args: { method: 'POST', url: 'https://merchant.example/api' },
        options: { data: "'{}'", maxSpend: 5, dryRun: true },
        description: 'Dry-run preview before paying (quote the JSON)',
      },
      {
        args: { method: 'POST', url: 'https://merchant.example/api' },
        options: { chain: 'tempo', data: "'{}'", maxSpend: 5 },
        description: 'Pay via Tempo MPP with a $5 ceiling',
      },
      {
        args: { method: 'GET', url: 'https://merchant.example/api' },
        options: { maxSpend: 0.01, retries: 2, timeout: 120 },
        description: 'GET with retries and longer timeout',
      },
    ],
    run(c) {
      return withCliErrors(async () => {
        const result = await pay({
          chain: c.options.chain,
          network: c.options.network,
          name: c.options.wallet,
          method: c.args.method.toUpperCase(),
          url: c.args.url,
          body: c.options.data,
          headers: parseHeaders(c.options.header),
          maxSpendUsd: c.options.maxSpend,
          timeoutSeconds: c.options.timeout,
          retries: c.options.retries,
          dryRun: c.options.dryRun,
          verbose: c.options.verbose,
          noPassport: c.options.noPassport,
        });
        return c.ok(result, {
          cta: {
            description: 'Next steps:',
            commands: [
              { command: 'history', options: { limit: true }, description: 'Review the payment in your local history' },
              { command: 'balance', description: 'Confirm the new balance after settlement' },
            ],
          },
        });
      });
    },
  });

  // ── identity (AgentScore SDK) ───────────────────────────────────────────────
  const apiKeyOpt = z.string().optional().describe('AgentScore API key (falls back to AGENTSCORE_API_KEY)');

  cli.command('reputation', {
    description: 'Look up the cached trust reputation for a wallet address (free tier — read-only)',
    args: z.object({ address: z.string().describe('EVM (0x...) or Solana base58 wallet address') }),
    options: z.object({
      chain: z.string().optional().describe('Optional chain filter (e.g., base, ethereum)'),
      apiKey: apiKeyOpt,
    }),
    examples: [
      { args: { address: '0xdb5aa553feeb2c3e3d03e8360b36fb0f7e480671' }, description: 'Look up a wallet across all chains' },
      { args: { address: '0xdb5aa553feeb2c3e3d03e8360b36fb0f7e480671' }, options: { chain: 'base' }, description: 'Restrict to one chain' },
    ],
    run(c) {
      return withCliErrors(async () => {
        const result = await reputation({ address: c.args.address, chain: c.options.chain, apiKey: c.options.apiKey });
        return c.ok(result);
      });
    },
  });

  cli.command('assess', {
    description:
      "Assess a wallet/operator's trustworthiness with policy (paid tier). Pass --address (wallet) or --operator-token (credential).",
    hint: 'Requires AGENTSCORE_API_KEY (or --api-key). Free-tier reputation is via `reputation`.',
    options: z.object({
      address: z.string().optional().describe('Wallet address — EVM (0x...) or Solana (base58)'),
      operatorToken: z.string().optional().describe('Operator credential (opc_...) for non-wallet identity'),
      chain: z.string().optional().describe('Optional chain filter'),
      requireKyc: z.boolean().optional().describe('Require KYC verification to allow'),
      requireSanctionsClear: z.boolean().optional().describe('Require operator clear of sanctions'),
      minAge: z.coerce.number().optional().describe('Minimum age bracket (18 or 21)'),
      blockedJurisdictions: z.array(z.string()).optional().describe('ISO country codes to block (repeatable)'),
      allowedJurisdictions: z.array(z.string()).optional().describe('ISO country codes to allow (repeatable)'),
      refresh: z.boolean().optional().describe('Force on-the-fly assessment instead of cached'),
      apiKey: apiKeyOpt,
    }),
    examples: [
      { options: { address: '0xabc...', requireKyc: true, minAge: 21 }, description: 'Wallet assessment with KYC + age 21+ policy' },
      { options: { operatorToken: 'opc_...' }, description: 'Operator-credential assessment' },
    ],
    run(c) {
      return withCliErrors(async () => {
        const result = await assess({
          address: c.options.address,
          operatorToken: c.options.operatorToken,
          chain: c.options.chain,
          requireKyc: c.options.requireKyc,
          requireSanctionsClear: c.options.requireSanctionsClear,
          minAge: c.options.minAge,
          blockedJurisdictions: c.options.blockedJurisdictions,
          allowedJurisdictions: c.options.allowedJurisdictions,
          refresh: c.options.refresh,
          apiKey: c.options.apiKey,
        });
        return c.ok(result);
      });
    },
  });

  // ── sessions group ──────────────────────────────────────────────────────────
  const sessions = Cli.create('sessions', {
    description: 'Identity verification sessions (paid tier)',
  });
  sessions.command('create', {
    description: 'Create an identity verification session — returns verify_url + poll credentials',
    options: z.object({
      address: z.string().optional().describe('Pre-associate session with a known wallet'),
      operatorToken: z.string().optional().describe('Refresh KYC for an existing operator credential'),
      context: z.string().optional().describe('Free-text context (e.g., "wine purchase")'),
      productName: z.string().optional().describe('Product name shown during verification (max 200 chars)'),
      apiKey: apiKeyOpt,
    }),
    examples: [
      { options: { context: 'wine purchase' }, description: 'Bootstrap a fresh verification session' },
      { options: { address: '0xabc...' }, description: 'Tie the session to an existing wallet' },
    ],
    run(c) {
      return withCliErrors(async () => {
        const result = await sessionCreate({
          address: c.options.address,
          operatorToken: c.options.operatorToken,
          context: c.options.context,
          productName: c.options.productName,
          apiKey: c.options.apiKey,
        });
        return c.ok(result, {
          cta: {
            description: 'Next steps:',
            commands: [
              { command: 'sessions get', args: { id: true }, description: 'Poll until status is verified to receive operator_token' },
            ],
          },
        });
      });
    },
  });
  sessions.command('get', {
    description: 'Poll a verification session — returns operator_token when status becomes verified',
    args: z.object({ id: z.string().describe('Session ID (sess_...)') }),
    options: z.object({
      pollSecret: z.string().optional().describe('Poll secret returned from sessions create'),
      apiKey: apiKeyOpt,
    }),
    examples: [
      { args: { id: 'sess_abc123' }, options: { pollSecret: 'ps_...' }, description: 'Poll one session' },
    ],
    run(c) {
      return withCliErrors(async () => {
        const result = await sessionGet({ id: c.args.id, pollSecret: c.options.pollSecret, apiKey: c.options.apiKey });
        if (result.status !== 'verified' || !result.operator_token) return c.ok(result);
        return c.ok(result, {
          cta: {
            description: 'Verified — use the operator_token to retry the original gated request:',
            commands: [
              { command: 'pay', description: 'Re-run the merchant request with -H "X-Operator-Token: <operator_token>"' },
              { command: 'associate-wallet', description: 'After paying, attribute the signer wallet to this operator credential' },
            ],
          },
        });
      });
    },
  });
  cli.command(sessions);

  // ── credentials group ───────────────────────────────────────────────────────
  const credentials = Cli.create('credentials', {
    description: 'Operator credentials (opc_...) for non-wallet agent identity (paid tier)',
  });
  credentials.command('create', {
    description: 'Create an operator credential. Run `credentials list` first — reuse beats creating.',
    hint: 'Returned credential is shown ONCE. Store it securely — there is no recovery flow.',
    options: z.object({
      label: z.string().optional().describe('Label for the credential (e.g., "claude-code")'),
      ttlDays: z.coerce.number().optional().describe('Time to live in days (default 1, max 365)'),
      apiKey: apiKeyOpt,
    }),
    examples: [
      { options: { label: 'claude-code', ttlDays: 7 }, description: 'Mint a 7-day credential labeled for Claude Code' },
    ],
    outputPolicy: 'agent-only',
    run(c) {
      return withCliErrors(async () => {
        const result = await credentialCreate({ label: c.options.label, ttlDays: c.options.ttlDays, apiKey: c.options.apiKey });
        return c.ok(result, {
          cta: {
            description: 'Next steps:',
            commands: [
              { command: 'pay', description: 'Use the credential as -H "X-Operator-Token: <credential>" on AgentScore-gated payments' },
              { command: 'credentials list', description: 'Audit active credentials at any time' },
            ],
          },
        });
      });
    },
  });
  credentials.command('list', {
    description: 'List active (non-expired, non-revoked) operator credentials',
    options: z.object({ apiKey: apiKeyOpt }),
    run(c) {
      return withCliErrors(async () => {
        const result = await credentialList({ apiKey: c.options.apiKey });
        if (result.credentials.length > 0) return c.ok(result);
        return c.ok(result, {
          cta: {
            description: 'No active credentials. Bootstrap one:',
            commands: [
              { command: 'sessions create', description: 'Start a fresh verification session if you need a credential' },
              { command: 'credentials create', options: { label: true }, description: 'Mint a credential directly (requires verified account)' },
            ],
          },
        });
      });
    },
  });
  credentials.command('revoke', {
    description: 'Revoke an operator credential by ID',
    args: z.object({ id: z.string().describe('Credential ID (cred_...)') }),
    options: z.object({ apiKey: apiKeyOpt }),
    run(c) {
      return withCliErrors(async () => {
        const result = await credentialRevoke({ id: c.args.id, apiKey: c.options.apiKey });
        return c.ok(result, {
          cta: {
            description: 'Next steps:',
            commands: [{ command: 'credentials list', description: 'Confirm the credential is gone' }],
          },
        });
      });
    },
  });
  cli.command(credentials);

  // ── passport group (AgentScore identity, browser-redirect login) ────────────
  const passport = Cli.create('passport', {
    description:
      'AgentScore Passport — buyer-side identity (KYC + verified facts). Stores an operator_token locally; auto-attached to merchant requests on settle.',
  });
  passport.command('login', {
    description:
      'Verify identity in your browser and save the resulting operator_token to ~/.agentscore/passport.json.',
    hint: 'No API key required. Opens a verify URL; pay polls until your KYC completes in browser.',
    options: z.object({
      pollIntervalSeconds: z.coerce.number().optional().describe('Poll cadence (default 5s)'),
      timeoutSeconds: z.coerce.number().optional().describe('Polling timeout (default 3600s)'),
    }),
    examples: [
      { description: 'Cold-start login — opens verify URL, polls until verified' },
    ],
    run(c) {
      return withCliErrors(async () => {
        let printedVerifyUrl = false;
        const result = await passportLoginCommand({
          pollIntervalSeconds: c.options.pollIntervalSeconds,
          timeoutSeconds: c.options.timeoutSeconds,
          onVerifyUrl: (verifyUrl) => {
            if (!printedVerifyUrl) {
              process.stderr.write(`\nOpen this URL to verify your AgentScore Passport:\n  ${verifyUrl}\n\nWaiting for verification...\n`);
              printedVerifyUrl = true;
            }
          },
        });
        return c.ok(result, {
          cta: {
            description: 'Passport active. Next steps:',
            commands: [
              { command: 'pay', description: 'Make a payment — pay auto-attaches X-Operator-Token to merchant requests' },
              { command: 'passport status', description: 'View verified facts + expiry at any time' },
            ],
          },
        });
      });
    },
  });
  passport.command('status', {
    description: 'Show stored AgentScore Passport — token prefix, expiry, expired flag.',
    options: z.object({}),
    run(c) {
      return withCliErrors(async () => {
        const result = await passportStatusCommand();
        if (!result.authenticated) {
          return c.ok(result, {
            cta: {
              description: 'Not authenticated. Next steps:',
              commands: [{ command: 'passport login', description: 'Verify your identity and store an operator_token locally' }],
            },
          });
        }
        return c.ok(result);
      });
    },
  });
  passport.command('logout', {
    description: 'Revoke the stored operator_token at AgentScore (best-effort) and remove ~/.agentscore/passport.json.',
    options: z.object({ apiKey: apiKeyOpt }),
    run(c) {
      return withCliErrors(async () => {
        const result = await passportLogoutCommand({ apiKey: c.options.apiKey });
        return c.ok(result);
      });
    },
  });
  cli.command(passport);

  // ── associate-wallet ────────────────────────────────────────────────────────
  cli.command('associate-wallet', {
    description:
      'Report a wallet that paid under an operator credential — builds the cross-merchant credential↔wallet attribution profile. Fire-and-forget.',
    options: z.object({
      operatorToken: z.string().describe('Operator credential (opc_...) the agent paid under'),
      walletAddress: z.string().describe('Wallet that signed the payment — EVM (0x...) or Solana (base58)'),
      network: z.enum(['evm', 'solana']).describe('Network family'),
      idempotencyKey: z.string().optional().describe('Stable per-payment key (PI id, x402 tx hash, etc.)'),
      apiKey: apiKeyOpt,
    }),
    examples: [
      {
        options: { operatorToken: 'opc_...', walletAddress: '0xabc...', network: 'evm', idempotencyKey: '0xtxhash' },
        description: 'Attribute an EVM payment to the credential',
      },
    ],
    run(c) {
      return withCliErrors(async () => {
        const result = await associateWallet({
          operatorToken: c.options.operatorToken,
          walletAddress: c.options.walletAddress,
          network: c.options.network,
          idempotencyKey: c.options.idempotencyKey,
          apiKey: c.options.apiKey,
        });
        return c.ok(result);
      });
    },
  });

  // ── agent-guide ─────────────────────────────────────────────────────────────
  cli.command('agent-guide', {
    description: 'Print structured how-to-use guidance for LLM tool-loop agents',
    run(c) {
      return withCliErrors(async () => {
        const result = await agentGuide();
        return c.ok(result, {
          cta: {
            description: 'Golden path:',
            commands: [
              { command: 'init', description: 'First-run setup — create wallets on every chain' },
              { command: 'check', description: 'Probe a 402-gated URL to see accepted rails + price' },
              { command: 'pay', options: { dryRun: true, maxSpend: true }, description: 'Dry-run a payment, then drop --dry-run to settle' },
            ],
          },
        });
      });
    },
  });

  return cli;
}

export async function run(): Promise<void> {
  const cli = buildCli();
  await cli.serve();
}
