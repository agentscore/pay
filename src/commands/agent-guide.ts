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

interface ErrorEnvelopeContract {
  channel: 'stdout';
  shape: {
    code: 'machine-readable error code (e.g. config_error, no_wallet, multi_rail_candidates)';
    message: 'human-readable error message';
    retryable: 'boolean — true for transient codes (network_error, rpc_error, session_timeout)';
    extra: 'optional object with structured recovery context per error code (e.g. valid_keys, chain, held_chains, balance_usdc, verify_url, session_id, poll_secret)';
    next_steps: 'optional { action: string, suggestion?: string } — deterministic recovery action slug + optional human-readable suggestion';
  };
  full_output_shape: 'with --full-output, the wire envelope is { ok: false, error: {...}, meta: { command, duration } } — fields above nest under `error`';
  human_tty_shape: 'when stdout is a TTY and no --format/--json/--full-output is set, errors render as a friendly one-liner: `Error (code): message` (no extras, no next_steps). Pass --json or pipe to get the structured envelope.';
}

interface AgentGuide {
  for_agents: true;
  intro: string;
  golden_path: GuideStep[];
  testnet_path: GuideStep[];
  funding: GuideStep[];
  auxiliary: GuideStep[];
  pitfalls: GuideStep[];
  error_envelope: ErrorEnvelopeContract;
  identity_error_recovery: IdentityErrorPattern[];
  exit_codes: Record<string, string>;
  json_mode: string;
}

const GUIDE: AgentGuide = {
  for_agents: true,
  intro:
    'agentscore-pay is the universal agent-payment CLI. It works against any x402/MPP merchant, ' +
    'AgentScore-gated or not, across x402 USDC on Base and MPP USDC on Tempo + Solana. Below is the ' +
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
      why: 'Required for AgentScore-gated merchants (regulated commerce: age-restricted, jurisdiction-restricted, or compliance-gated services). The agent shares the verify URL with the user; the user completes KYC once in the browser; pay saves the operator_token + a long-lived refresh_token to ~/.agentscore/passport.json. Every subsequent `agentscore-pay <url>` call auto-attaches `X-Operator-Token`; no per-call prompting. Skipping this step is fine for unregulated merchants; pay will run anonymous and the merchant\'s 402 will tell you if identity is required.',
      command_example: 'agentscore-pay passport login --json',
      notes: [
        'No API key required. ~30 seconds in browser. No money needed for this step.',
        'Token lifecycle: access token = 24h (auto-rotated via the refresh_token, which is 90d). Pay refreshes silently on the next call after access expires — no agent action required. Re-verify in browser is needed only when both have expired, i.e. when the agent has been offline for ~90 days.',
'If you skip step 1 and a merchant 403 mid-purchase forces inline bootstrap from a merchant-supplied session (verify_url + session_id + poll_secret in the 403 body), the resulting Passport carries an access token but no refresh_token — that path re-verifies after 24h. Bootstrap-from-stored-expiry (pay falling through to `passport login` after a fully-expired stored Passport) still mints a refresh-bearing pair. Doing `passport login` first up front avoids both edge cases and gets the 90-day silent-refresh UX.',
        'Caller-supplied `-H "X-Operator-Token: ..."` always wins over the stored Passport. Use `--skip-passport` for explicit-anonymous traffic.',
        'When pay needs to re-verify (refresh failed AND access expired): in a non-TTY context (agent, --json, MCP, scripted) pay throws `code: passport_login_required` with `next_steps.action: passport_login` immediately rather than blocking on a browser flow. Run `agentscore-pay passport login` interactively to mint a fresh pair, then re-run the original command. In a human TTY, pay drives the inline browser-redirect flow itself and prints `Open this URL to renew:` on stderr — surface the URL verbatim if you proxy it; do not fabricate one.',
      ],
    },
    {
      step: '2. (Optional) Discover merchants with `discover`',
      why: 'Lists x402/MPP services from the x402 Bazaar (Coinbase) + MPP services directory (Tempo) — works against any merchant, AgentScore-gated or not.',
      command_example: 'agentscore-pay discover --json',
      notes: [
        'Use --search, --chain, --max-price, --protocol to narrow. Returns rail metadata (network, payTo, asset, price) per service.',
        'Skip this step if you already know the URL you want to pay.',
      ],
    },
    {
      step: '3. Confirm funds with `balance`',
      why: 'Pay rejects with exit code 3 when the chosen chain has insufficient USDC. Check first to avoid wasted round-trips. Each row also surfaces the wallet\'s native-gas balance (ETH on Base, the Tempo native token on Tempo, SOL on Solana) — needed for raw on-chain operations like `send` and `revoke`.',
      command_example: 'agentscore-pay balance --json',
      notes: [
        'Pass --network testnet to check testnet balances (Base Sepolia, Solana devnet, Tempo testnet).',
        'If a chain is empty, run `agentscore-pay fund --chain <chain>` for a receive QR (mainnet) or testnet faucet/programmatic mint.',
        'Each row includes `usdc`, `native` (gas balance), and `native_symbol`. x402/MPP payments are gasless from the agent perspective; `send` and `revoke` are not — they need a non-zero `native` balance to write on-chain.',
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
      step: 'Get MAINNET USDC with `fund` (external wallet — default)',
      why: '`fund` prints a receive QR for the wallet address and polls balance until USDC lands. The user funds from any source they prefer (CEX withdrawal, another wallet, fiat onramp). Works on every chain.',
      command_example: 'agentscore-pay fund --chain base --json',
      notes: [
        'Tempo TESTNET via `fund` calls the same programmatic mint as `faucet` — free, immediate, no browser. `fund --chain tempo --network testnet` works without prompts.',
        'All mainnet networks behave the same: receive QR + balance poll. The user picks the funding source — CEX, another wallet, or any third-party onramp that supports the destination chain.',
        'Use `fund-estimate <URL>` to compute "how many calls does my current balance cover for this merchant" — useful before deciding whether to top up.',
      ],
    },
    {
      step: 'Preview Stripe Crypto Onramp price BEFORE committing (--quote-only)',
      why: '`fund --via stripe-onramp --quote-only --amount <USD>` returns the destination USDC amount + network/transaction fees + source-total (USD inclusive of fees) WITHOUT minting a session. Use to show the user the real cost before they decide.',
      command_example: 'agentscore-pay fund --chain base --via stripe-onramp --amount 25 --quote-only --json',
      notes: [
        'Read-only call — no Stripe session is minted, no wallet binding occurs. Safe to call repeatedly.',
        'No passport login required (quotes are public Stripe pricing). Returns `status: "quote_only"` + a `quote` object containing destination_amount, source_total_amount, network_fee_monetary, transaction_fee_monetary.',
        'Then run the same command WITHOUT --quote-only to mint the session and start the onramp flow.',
      ],
    },
    {
      step: 'Buy MAINNET USDC with a card via Stripe Crypto Onramp (--via stripe-onramp)',
      why: '`fund --via stripe-onramp --amount <USD>` mints a Stripe-hosted onramp session bound to the wallet. Stripe handles KYC + card payment and delivers USDC to the wallet. Useful when the user has no existing crypto and no exchange account. Use `--destination-amount <USDC>` instead of `--amount` to fix the USDC received instead of the USD paid.',
      command_example: 'agentscore-pay fund --chain base --via stripe-onramp --amount 25 --json',
      notes: [
        'BASE + SOLANA mainnet only (Stripe Crypto Onramp coverage). Tempo + all testnets fall back to the default external-wallet flow.',
        'US + EU buyers only. Outside those regions, the API returns `region_not_supported` with `agent_instructions.action: use_alternative_funding_method` — switch to default `fund` (no --via).',
        'pay NEVER auto-opens a browser. The CLI emits `onramp_session_created` on stderr with the hosted `crypto.link.com` URL; the user clicks/scans it. Agents must NOT pick this method on the user\'s behalf without consent — surface the option (ideally after `--quote-only`), let the user choose.',
        'Stripe collects KYC fresh per session for first-time users; Stripe Link short-circuits for returning buyers (opaque to pay).',
        'Requires a prior `agentscore-pay passport login` — the API resolves the session to the agent\'s account via the stored operator_token.',
      ],
    },
  ],

  auxiliary: [
    {
      step: 'Raw transfer to an arbitrary address with `send`',
      why: 'Different from `pay <url>` — no merchant, no 402 handshake, just an on-chain transfer from the local wallet to the destination. Default `--asset usdc` sends USDC (ERC20 on Base/Tempo, SPL on Solana). `--asset native` sends gas tokens (ETH on Base, TEMPO on Tempo, SOL on Solana). Works on mainnet AND testnets (pass `--network testnet`).',
      command_example: 'agentscore-pay send --chain base --to 0xRecipient --amount 5 --json',
      notes: [
        'Requires native gas in the signer wallet for BOTH flavors: gas pays the on-chain write itself, regardless of which asset is being transferred. x402/MPP payments are gasless from the agent perspective; raw transfers are not.',
        '`--asset usdc` (default): ERC20 `transfer(to, amount)` on EVM; SPL `TransferChecked` + idempotent ATA creation on Solana. The fee payer is the sender; sender needs SOL for the ATA-creation rent on Solana if the recipient doesn\'t already have one.',
        '`--asset native`: viem `sendTransaction({to, value})` on EVM; `getTransferSolInstruction` on Solana. No token-contract interaction.',
        'Validation: --to must be a valid address for the chain (0x-prefixed 40-hex for EVM, base58 32-44 chars for Solana). EVM zero address is rejected.',
        'Returns `{tx_hash, from, to, amount_usdc | amount_native, asset, native_symbol?, chain, network}` on success. Insufficient-gas errors surface as code=insufficient_balance with action=fund_native_gas.',
        'EVM transfers wait for the on-chain receipt before returning: a `tx_hash` back means the tx actually settled. A tx that reverts on-chain (or fails gas estimation) surfaces as code=transfer_reverted, never a success envelope with a hash for a tx that moved no funds.',
        'Tempo pays the network fee in the stablecoin itself, so a USDC `send` of your ENTIRE balance reverts (no headroom left for the fee) with code=transfer_reverted. Leave a little `--amount` headroom below the balance.',
        'Network: pass `--network testnet` to operate on Base Sepolia / Solana devnet / Tempo Moderato. Same code path, different RPC + token mint.',
      ],
    },
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
        'Limits are local-only and advisory; the merchant cannot read or override them.',
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
      why: 'After the initial `passport login` (golden-path step 1), most flows are zero-touch — silent refresh keeps the token fresh. Use `passport status` to inspect what\'s saved; re-run `passport login` only when the agent has been offline beyond the refresh window (i.e. when `silent_refresh_available` is false).',
      command_example: 'agentscore-pay passport status --json',
      notes: [
        '`passport status` returns `{ authenticated, operator_token_prefix, expires_at, expires_in_days, expired, silent_refresh_available, refresh_expires_at, refresh_expires_in_days }`. The access fields (`expires_*`) are short-lived (~24h) and rotate silently; do not surface "expires in 0 days" to the user as an actionable warning. The refresh fields (`refresh_expires_*`) are the meaningful re-verify horizon — that\'s when the user actually has to do something.',
        '`silent_refresh_available: true` means pay will rotate the access token automatically on the next call when it expires; agent has nothing to do. `silent_refresh_available: false` (legacy passport, or merchant-mint cold-start without refresh_token) means the next access expiry forces a verify-URL prompt.',
        'Caller-supplied `-H "X-Operator-Token: ..."` always wins over the stored Passport, so existing scripts keep working.',
        'Non-AgentScore merchants ignore the header — auto-attach is harmless on those endpoints.',
        'Use `--skip-passport` on `agentscore-pay <url>` for explicit-anonymous traffic.',
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
      cli_code: 'passport_login_required',
      thrown_when:
        'Stored AgentScore Passport access token has expired AND silent refresh did not succeed (refresh_token revoked, network failure, rate-limited, or no refresh_token at all because the Passport was minted via a merchant 403 cold-start). Only thrown in non-TTY contexts (--json, MCP, scripted, piped); a human TTY drives the inline browser flow instead.',
      next_action: 'passport_login',
      recovery:
        'Run `agentscore-pay passport login` interactively (one-time browser click) to mint a fresh access + refresh credential pair, then re-run the original command. The new credential lasts ~90 days before another re-verify is needed. `extra.previous_token_prefix` identifies which stored Passport was rejected, when the agent juggles multiple environments.',
    },
    {
      cli_code: 'passport_required_by_merchant',
      thrown_when:
        'Merchant returned a 403 with bootstrap fields (verify_url + session_id + poll_secret) and the agent has no usable stored Passport. Only thrown in non-TTY contexts; a human TTY drives the inline browser flow instead. Symmetric to passport_login_required but covers the cold-start case where the agent never logged in to begin with.',
      next_action: 'passport_login',
      recovery:
        'Recommended: run `agentscore-pay passport login` first — mints a portable refresh-bearing Passport that satisfies any AgentScore-gated merchant going forward, no per-merchant re-verify. Alternative: surface `extra.verify_url` to the user verbatim; completing it issues a one-shot 24h token tied to that merchant\'s session (no refresh_token, so the next AgentScore-gated merchant will hit the same flow again).',
    },
    {
      cli_code: 'config_error',
      thrown_when:
        'AGENTSCORE_API_KEY missing (getClient throws directly with action=set_api_key); OR API key invalid/expired (generic 401 → action=check_api_key); OR operator_token expired/revoked (TokenExpiredError → action=reauth, exposes verify_url + session_id + poll_secret in extra); OR operator_token unrecognized (InvalidCredentialError → action=switch_token_or_restart_session).',
      next_action: 'See envelope.next_steps.action — set_api_key / check_api_key / reauth / switch_token_or_restart_session',
      recovery:
        'For reauth: run `agentscore-pay passport login` to mint a fresh operator_token (no API key needed), or use the verify_url + session_id + poll_secret from extra to drive the verify/poll flow manually. For switch_token_or_restart_session: use a different stored operator_token, or run `passport login`. For check_api_key / set_api_key: confirm AGENTSCORE_API_KEY is valid and set in env; key issues will not reauth-fix via passport.',
    },
    {
      cli_code: 'insufficient_balance',
      thrown_when: 'PaymentRequiredError — the requested endpoint is not enabled for the API key\'s account (HTTP 402).',
      next_action: 'upgrade_plan',
      recovery: 'Surface the suggestion to the user. See https://www.agentscore.com/pricing — agent retry will not fix this.',
    },
    {
      cli_code: 'quota_exceeded',
      thrown_when: 'QuotaExceededError — account-level cap hit (HTTP 429 quota_exceeded).',
      next_action: 'upgrade_plan',
      recovery:
        'Do NOT retry — agent retry will not fix this. Surface to the user with https://www.agentscore.com/pricing. Use AssessResponse.quota on success responses to monitor approach-to-cap proactively (warn at 80%, alert at 95%) before hitting this state.',
    },
    {
      cli_code: 'network_error',
      thrown_when:
        'RateLimitedError (per-second cap, HTTP 429 rate_limited), TimeoutError (request timed out), or generic httpx.HTTPError (DNS / network / 5xx) wrapped by the SDK.',
      next_action: 'retry_with_backoff',
      recovery:
        'Retry once with backoff (5–30s typical, longer if Retry-After header was present). If sustained, surface to user with AgentScore\'s status page or support contact — pay calls api.agentscore.com directly, no merchant in the loop here.',
    },
    {
      cli_code: 'merchant_error',
      thrown_when:
        'Fallback for any other AgentScoreError that does not match the typed subclasses above (e.g. HTTP 400 invalid_request, 404 not_found, 410 route_deprecated). The original code + status are preserved in extra.',
      next_action: 'inspect_extra',
      recovery:
        'Read extra.code and extra.status to understand the specific failure. 400-class issues mean the agent\'s request body or args were wrong (validate inputs); 410 means the endpoint was deprecated (consult the integrations doc for the replacement).',
    },
  ],

  error_envelope: {
    channel: 'stdout',
    shape: {
      code: 'machine-readable error code (e.g. config_error, no_wallet, multi_rail_candidates)',
      message: 'human-readable error message',
      retryable: 'boolean — true for transient codes (network_error, rpc_error, session_timeout)',
      extra: 'optional object with structured recovery context per error code (e.g. valid_keys, chain, held_chains, balance_usdc, verify_url, session_id, poll_secret)',
      next_steps: 'optional { action: string, suggestion?: string } — deterministic recovery action slug + optional human-readable suggestion',
    },
    full_output_shape:
      'with --full-output, the wire envelope is { ok: false, error: {...}, meta: { command, duration } } — fields above nest under `error`',
    human_tty_shape:
      'when stdout is a TTY and no --format/--json/--full-output is set, errors render as a friendly one-liner: `Error (code): message` (no extras, no next_steps). Pass --json or pipe to get the structured envelope.',
  },

  exit_codes: {
    '0': 'success',
    '1': 'user error (bad args, missing wallet, wrong passphrase, account quota)',
    '2': 'network error (merchant unreachable, RPC failure)',
    '3': 'insufficient funds',
    '4': 'payment rejected (exceeds --max-spend, local limit hit)',
    '5': 'multi-rail ambiguity (requires --chain or preferred_chains config)',
  },

  json_mode:
    'Every command emits structured data. Pass --json (or --format json/yaml/md/jsonl) to lock the format; ' +
    'TOON is the default in non-TTY (agent) contexts (token-efficient). Errors emit `{code, message, retryable, extra?, next_steps?}` ' +
    'on stdout (same channel as success — branch on `code` presence). Use --filter-output for dot-path pruning, ' +
    '--token-limit/--token-offset for paginated output, --full-output for the full envelope, and `agentscore-pay --mcp` to expose every command as MCP tools over stdio.',
};


export async function agentGuide(): Promise<AgentGuide> {
  return GUIDE;
}
