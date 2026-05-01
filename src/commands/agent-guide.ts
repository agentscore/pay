/**
 * `agent-guide` — structured how-to-use guidance for LLM agents wiring pay into a tool loop.
 *
 * Plain text in TTY mode (human/agent reads it line-by-line), structured JSON in `--json` mode
 * (programmatic parsing — agents that prefer JSON can ingest the same content).
 */
interface GuideStep {
  step: string;
  why: string;
  command_example?: string;
  notes?: string[];
}

interface IdentityErrorPattern {
  cli_code: string;
  thrown_when: string;
  next_action: string;
  recovery: string;
}

interface AgentGuide {
  for_agents: true;
  intro: string;
  golden_path: GuideStep[];
  testnet_path: GuideStep[];
  funding: GuideStep[];
  auxiliary: GuideStep[];
  pitfalls: GuideStep[];
  identity_error_recovery: IdentityErrorPattern[];
  exit_codes: Record<string, string>;
  json_mode: string;
}

const GUIDE: AgentGuide = {
  for_agents: true,
  intro:
    'agentscore-pay is the universal agent-payment CLI. It works against any 402/MPP merchant — ' +
    'AgentScore-gated or not — across x402 USDC on Base + Solana and MPP on Tempo. Below is the ' +
    'minimum-friction path for an LLM tool-loop agent.',

  golden_path: [
    {
      step: '0. (First run only) Bootstrap the wallet with `init`',
      why: 'Creates the AES-encrypted keystore + a wallet on each chain (base, solana, tempo). Skip if the wallet already exists at ~/.agentscore.',
      command_example: 'agentscore-pay init --json',
      notes: [
        'Without a wallet pay cannot sign payments. `init` is idempotent — safe to call repeatedly; it skips chains that already have a keystore.',
        'Set AGENTSCORE_PAY_PASSPHRASE in env to skip the interactive passphrase prompt during agent runs.',
      ],
    },
    {
      step: '1. (First run only) Verify identity with `passport login`',
      why: 'Required for AgentScore-gated merchants (regulated commerce: wine, age-restricted goods, jurisdiction-restricted services). The agent shares the verify URL with the user; the user completes KYC once in the browser; pay saves the operator_token to ~/.agentscore/passport.json. Every subsequent `pay <url>` call auto-attaches `X-Operator-Token` — no per-call prompting. Tokens are short-lived; pay refreshes them silently and drives inline reauth on hard expiry. Skipping this step is fine for unregulated merchants — pay will run anonymous and the merchant\'s 402 will tell you if identity is required.',
      command_example: 'agentscore-pay passport login --json',
      notes: [
        'No API key required. ~30 seconds in browser. No money needed for this step.',
        'If you skip this and later hit an AgentScore-gated merchant, pay drives the same verify flow inline mid-purchase (cold-start bootstrap) — but the resulting Passport lacks a refresh token and re-verifies after 24h. Doing `passport login` first gets the better long-term UX.',
        'Caller-supplied `-H "X-Operator-Token: ..."` always wins over the stored Passport. Use `--no-passport` for explicit-anonymous traffic.',
      ],
    },
    {
      step: '2. (Optional) Discover merchants with `discover`',
      why: 'Lists 402/MPP services from the x402 Bazaar (Coinbase) + MPP services directory (Tempo) — works against any merchant, AgentScore-gated or not.',
      command_example: 'agentscore-pay discover --json',
      notes: [
        'Use --search, --chain, --max-price, --protocol to narrow. Returns rail metadata (network, payTo, asset, price) per service.',
        'Skip this step if you already know the URL you want to pay.',
      ],
    },
    {
      step: '3. Confirm funds with `balance`',
      why: 'Pay rejects with exit code 3 when the chosen chain has insufficient USDC. Check first to avoid wasted round-trips.',
      command_example: 'agentscore-pay balance --json',
      notes: [
        'Pass --network testnet to check testnet balances (Base Sepolia, Solana devnet, Tempo testnet).',
        'If a chain is empty, run `agentscore-pay fund --chain <chain>` for an onramp link or testnet faucet.',
      ],
    },
    {
      step: '4. Probe the endpoint with `check` BEFORE paying',
      why: 'Confirms the merchant returns a 402, parses the accepted rails + price, and tells you which chain you should pay from. No funds move.',
      command_example: 'agentscore-pay check <URL> -X POST -d \'{"key":"value"}\' --json',
      notes: [
        'Use the same HTTP method + body you intend to use for the paid request. Most paid endpoints require POST + JSON body — a GET probe will return 404/405 from those merchants.',
        'pay sets `Content-Type: application/json` automatically when -d is present. DO NOT also pass `-H \'content-type: application/json\'` — that is redundant. Pay dedupes case-insensitively but the cleanest invocation omits the redundant header.',
      ],
    },
    {
      step: '5. Dry-run the payment before paying real money',
      why: 'Shows the rail pay would select, the signer wallet, the balance, and the body it would send — without signing or sending. Catches misconfigurations cheaply.',
      command_example: 'agentscore-pay pay POST <URL> -d \'{...}\' --chain <base|solana|tempo> --max-spend 0.05 --dry-run --json',
      notes: [
        'Always pass --max-spend with a reasonable upper bound. pay rejects payments above this USD amount with exit code 4.',
        'When the merchant accepts multiple rails, pay needs `--chain` to disambiguate. If you skip it, pay exits with code 5 (multi-rail ambiguity) and lists the candidates. Set persistent preference via `agentscore-pay config set preferred-chains tempo,base` to avoid passing --chain every call.',
      ],
    },
    {
      step: '6. Pay for real when ready',
      why: 'Same command, drop --dry-run. Pay handles the 402 round-trip end-to-end: probe → sign → settle → resend with payment proof → return the merchant\'s 200 response body.',
      command_example: 'agentscore-pay pay POST <URL> -d \'{...}\' --chain <chain> --max-spend 0.05 --json',
      notes: [
        'On success, pay prints the merchant\'s response body to stdout. In --json mode you also get tx hash, settlement details, and merchant headers (e.g. payment-response).',
        'Exit code 0 = success. Non-zero codes are listed below — agents should branch on them.',
        'Tunables: `--timeout <s>` aborts the merchant request after N seconds (default 60). `--retries <n>` retries transient network errors (default 0; per-scheme nonces prevent double-spend).',
      ],
    },
  ],

  testnet_path: [
    {
      step: 'Develop against testnets first — same code path, no real money',
      why: 'Every command accepts `--network testnet`. The wallet has separate testnet balances per chain (Base Sepolia, Solana devnet, Tempo testnet — chain id 42431). Pay routes to the correct facilitator + RPC automatically based on --network.',
      command_example: 'agentscore-pay pay POST <URL> --chain base --network testnet -d \'{...}\' --max-spend 1 --json',
      notes: [
        'Mainnet is the default for every command. Pass `--network testnet` to switch (or `agentscore-pay config set preferred-chains` does NOT cover network — pass per-call).',
        'Testnet endpoints are scarce in the public bazaar today. Most production merchants only run on mainnet. Stand up your own `@agent-score/commerce` or `x402` server in testnet mode for end-to-end smoke.',
      ],
    },
  ],

  funding: [
    {
      step: 'Get TESTNET USDC for free with `faucet`',
      why: 'Tempo testnet supports programmatic minting via `tempo_fundAddress` JSON-RPC — no signup, immediate. Base Sepolia + Solana devnet point you at the standard faucet URLs (and copy the address to clipboard).',
      command_example: 'agentscore-pay faucet --chain tempo --network testnet --json',
      notes: [
        'Tempo testnet: pay calls the RPC and your wallet is funded in seconds. No browser visit needed.',
        'Base Sepolia + Solana devnet: pay prints the faucet URL + your address. You complete the faucet form in a browser.',
      ],
    },
    {
      step: 'Get MAINNET USDC with `fund`',
      why: '`fund` walks the user through Coinbase Onramp (Base + Solana mainnet) or prints a receive QR + balance polling (Tempo mainnet has no public onramp).',
      command_example: 'agentscore-pay fund --chain base --json',
      notes: [
        'Tempo TESTNET via `fund` calls the same programmatic mint as `faucet` — free, immediate, no browser. `fund --chain tempo --network testnet` works without prompts.',
        'Tempo MAINNET via `fund` prints a receive QR; the user has to acquire USDC.e on Tempo via a CEX or bridge themselves (no onramp partner today).',
        'Base/Solana mainnet `fund` opens Coinbase Onramp — the user completes a card or bank purchase, pay polls until USDC lands in the wallet.',
        'Use `fund-estimate <URL>` to compute "how many calls does my current balance cover for this merchant" — useful before deciding whether to top up.',
      ],
    },
  ],

  auxiliary: [
    {
      step: 'Skip the passphrase prompt with `unlock` (when env var is not an option)',
      why: 'Each pay/wallet call decrypts the keystore and normally prompts for the passphrase. Agents can either set AGENTSCORE_PAY_PASSPHRASE in the env, or — when env vars are not controllable — run `unlock --for <ttl>` once to cache the passphrase to ~/.agentscore/.unlock for a bounded duration (max 8h).',
      command_example: 'agentscore-pay unlock --for 1h',
      notes: [
        'Use `agentscore-pay unlock --clear` when finished to wipe the cache early.',
        'AGENTSCORE_PAY_PASSPHRASE in env always wins over the cache and produces no on-disk artifact — prefer it in CI or any ephemeral execution context.',
      ],
    },
    {
      step: 'Set persistent spending limits with `limits set`',
      why: 'Belt-and-suspenders alongside per-call --max-spend. Limits persist in ~/.agentscore/limits.json and are enforced by every pay invocation: --daily (rolling 24h, all merchants), --per-call (single call), --per-merchant (lifetime, by host).',
      command_example: 'agentscore-pay limits set --daily 5 --per-call 0.50 --per-merchant 2',
      notes: [
        '`agentscore-pay limits show --json` prints the current ceilings; `limits clear` removes the file (no limits = no enforcement).',
        'Limits are local-only and advisory — they protect against runaway agent loops, not malicious merchants.',
      ],
    },
    {
      step: 'Inspect full wallet state with `whoami`',
      why: 'Single call returns wallets per chain, balances, and active config preferences in one JSON payload — useful for an agent to ground itself before deciding what to do next.',
      command_example: 'agentscore-pay whoami --json',
    },
    {
      step: 'Audit past payments with `history`',
      why: 'Every successful pay call appends to ~/.agentscore/history.jsonl. `history --json` returns timestamp, chain, signer, url, status, price, tx_hash — useful for retro/debug or surfacing "this merchant was already paid".',
      command_example: 'agentscore-pay history --json --limit 20',
    },
    {
      step: 'Inspect / renew the stored Passport with `passport status` / `passport login`',
      why: 'After the initial `passport login` (golden-path step 1), most flows are zero-touch — silent refresh keeps the token fresh. Use `passport status` to inspect what\'s saved (token prefix, expiry, expired flag); re-run `passport login` if expired or to re-mint after `passport logout`.',
      command_example: 'agentscore-pay passport status --json',
      notes: [
        'Caller-supplied `-H "X-Operator-Token: ..."` always wins over the stored Passport, so existing scripts keep working.',
        'Non-AgentScore merchants ignore the header — auto-attach is harmless on those endpoints.',
        'Use `--no-passport` on `pay <url>` for explicit-anonymous traffic.',
      ],
    },
  ],

  pitfalls: [
    {
      step: 'Pitfall: passing -H \'content-type: ...\' alongside -d',
      why: 'Historically caused duplicated Content-Type headers (`application/json, application/json`), which strict body-parsers reject as malformed. Now deduped case-insensitively, but the cleanest invocation just omits the redundant header — pay sets it for you.',
    },
    {
      step: 'Pitfall: probing with GET when the merchant requires POST',
      why: 'Many MPP/x402 merchants only respond with 402 to the same method + body shape they expect for paid traffic. A bare GET on a POST-only endpoint returns 404/405, looking like "no payment required" — but the endpoint really is paid.',
    },
    {
      step: 'Pitfall: skipping --max-spend',
      why: 'No upper bound = pay will sign whatever the merchant asks. Always pass --max-spend with a value you\'re comfortable losing if the merchant turns out to be malicious or misconfigured.',
    },
    {
      step: 'Pitfall: forgetting --chain on multi-rail merchants',
      why: 'When a merchant offers Tempo + Base + Solana, pay refuses to guess. Pass --chain explicitly OR set `preferred_chains` in ~/.agentscore/config.json (`agentscore-pay config set preferred-chains tempo,base`). Exit code 5 means you hit this case.',
    },
    {
      step: 'Pitfall: assuming non-spec-compliant 402 bodies will parse',
      why: 'A few merchants return 402 with custom JSON shapes that omit standard `accepts[]` / `WWW-Authenticate`. `check` reports 402 detected but rails not parsed — pay cannot construct a payment without the rail metadata. File an issue with the merchant.',
    },
  ],

  identity_error_recovery: [
    {
      cli_code: 'config_error',
      thrown_when:
        'AGENTSCORE_API_KEY missing or invalid; OR operator_token expired/revoked (TokenExpiredError, exposes verify_url + session_id + poll_secret in extra); OR operator_token unrecognized (InvalidCredentialError).',
      next_action: 'reauth or check_api_key (see envelope.next_steps.action)',
      recovery:
        'For TokenExpiredError: run `agentscore-pay passport login` to mint a fresh operator_token (no API key needed), or use the verify_url + session_id + poll_secret from extra to drive the verify/poll flow manually. For InvalidCredentialError: switch to a different stored operator_token, or run `passport login`. For check_api_key: confirm AGENTSCORE_API_KEY is valid; key issues will not reauth-fix via passport.',
    },
    {
      cli_code: 'insufficient_balance',
      thrown_when: 'PaymentRequiredError — the requested endpoint is not enabled for the API key\'s account (HTTP 402).',
      next_action: 'upgrade_plan',
      recovery: 'Surface the suggestion to the user. See https://agentscore.sh/pricing — agent retry will not fix this.',
    },
    {
      cli_code: 'quota_exceeded',
      thrown_when: 'QuotaExceededError — account-level cap hit (HTTP 429 quota_exceeded).',
      next_action: 'upgrade_plan',
      recovery:
        'Do NOT retry. Surface to user. Cap will not lift until the period resets or plan is upgraded. Use AssessResponse.quota field on success responses to monitor approach-to-cap proactively (warn at 80%, alert at 95%) before hitting this state.',
    },
    {
      cli_code: 'network_error',
      thrown_when:
        'RateLimitedError (per-second cap, HTTP 429 rate_limited), SdkTimeoutError (request timed out), or generic httpx.HTTPError (DNS / network / 5xx) wrapped by the SDK.',
      next_action: 'retry_with_backoff',
      recovery:
        'Retry once with backoff (5–30s typical, longer if Retry-After header was present). If sustained, surface to user with the merchant\'s support contact.',
    },
  ],

  exit_codes: {
    '0': 'success',
    '1': 'user error (bad args, missing wallet, wrong passphrase, account quota)',
    '2': 'network error (merchant unreachable, RPC failure)',
    '3': 'insufficient funds',
    '4': 'payment rejected (exceeds --max-spend, signer mismatch)',
    '5': 'multi-rail ambiguity (requires --chain or preferred_chains config)',
  },

  json_mode:
    'Every command emits structured data. Pass --json (or --format json/yaml/md/jsonl) to lock the format; ' +
    'TOON is the default in agent contexts (token-efficient). Errors emit `{code, message, retryable, hint?}` on stderr ' +
    'with stable exit codes. Use --filter-output for dot-path pruning, --token-limit/--token-offset for paginated output, ' +
    '--full-output for the full envelope, and `agentscore-pay --mcp` to expose every command as MCP tools over stdio.',
};


export async function agentGuide(): Promise<AgentGuide> {
  return GUIDE;
}
