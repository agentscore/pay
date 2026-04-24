# @agent-score/pay

CLI wallet for one-shell-command agent payments across **x402** (Base, Solana) and **MPP** (Tempo).

Closes the UX gap for shell-tool LLM agents (Claude Code, Cursor, ChatGPT with Bash) that want to pay protocol-gated endpoints. Mirrors the ergonomics of `tempo request` for MPP — one shell command, body preserved, agent never sees a private key on the wire — but works across every rail an AgentScore-gated merchant might accept.

## Install

```bash
# Run directly (no global install required)
npx @agent-score/pay --help

# Or install globally
npm i -g @agent-score/pay
agentscore-pay --help
```

Requires Node 20+. Native single-file binaries (no Node required) are built via `bun run build:binary:all`.

## Quick start

```bash
# 1. Create an encrypted keystore for every chain at once
agentscore-pay wallet create

# 2. Fund one of them (prints Coinbase Onramp URL + QR + polls balance)
agentscore-pay fund --chain base --amount 10

# 3. Pay — rail auto-selected from the single funded wallet
agentscore-pay pay POST https://agents.martinestate.com/purchase \
  -H 'Content-Type: application/json' \
  -d '{"product_id":"cabernet-sauvignon-2021","quantity":1,"email":"a@b.co","shipping":{...}}' \
  --max-spend 250
```

If multiple wallets are funded, specify the rail (or set `preferred_chains` in config):

```bash
agentscore-pay pay POST https://merchant.example/api --chain tempo -d '...' --max-spend 5
```

## Agents (scripting)

Every command supports `--json` for machine-readable output. Errors go to stderr as structured JSON; success payloads go to stdout as JSON. Exit codes are stable:

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | user error (bad args, missing wallet, wrong passphrase) |
| 2 | network error (merchant unreachable, RPC failure) |
| 3 | insufficient funds |
| 4 | payment rejected (exceeds `--max-spend`, local limit hit) |
| 5 | multi-rail ambiguity (requires `--chain` or `preferred_chains` config) |

```bash
# Scripted, non-interactive
export AGENTSCORE_PAY_PASSPHRASE=<passphrase>

# Probe without paying
agentscore-pay check https://merchant.example/api --json

# Dry-run a payment (print the plan, don't sign)
agentscore-pay pay POST https://merchant.example/api \
  -d '{"x":1}' --max-spend 5 --dry-run --json

# Real pay
agentscore-pay pay POST https://merchant.example/api \
  -d '{"x":1}' --max-spend 5 --json
```

When stdout is not a TTY (piped, redirected), `--plain` is automatically applied and structured output mirrors `--json`'s shape where applicable.

## Rails

| Chain | Protocol | Library | Network |
|---|---|---|---|
| `base` | x402 (EIP-3009) | `@x402/fetch` + `@x402/evm` | `eip155:8453` |
| `solana` | x402 (SPL Token) | `@x402/fetch` + `@x402/svm` | `solana:5eykt...` |
| `tempo` | MPP | `mppx/client` | chain 4217 |

The rail set matches Stripe's x402 facilitator chains (Tempo, Base, Solana). Tempo is always MPP — its x402 story is Stripe-facilitator-only and nascent.

## Rail selection

The CLI ships with **no default rail preference**. Algorithm:

1. `--chain X` was passed → use X (error if not present or insufficient).
2. Exactly one wallet on disk is funded for the target → use it.
3. Multiple funded wallets → check `~/.agentscore/config.json` `preferred_chains` as a tiebreaker.
4. Still multiple → error with `code: "multi_rail_candidates"` and list the options.
5. Zero candidates → error with `code: "no_funded_rail"` and point to `fund`.

Config example (`~/.agentscore/config.json`):

```json
{
  "preferred_chains": ["tempo", "base"]
}
```

Verbose mode (`-v`) logs rail selection + balances to stderr.

## Commands

| Command | Purpose |
|---|---|
| `wallet create [--chain c]` | Generate keystore(s). Omit `--chain` to create all three in one prompt. |
| `wallet import <key> --chain c` | Import existing key (hex for EVM, base64 for Solana) |
| `wallet address --chain c` | Print the address |
| `wallet export --chain c --danger` | Decrypt + print the private key (type-to-confirm; `--skip-confirm` for scripting) |
| `balance [--chain c]` | USDC balance across chains |
| `qr --chain c [--amount N]` | ASCII QR or EIP-681 / `solana:` URI |
| `fund --chain c [--amount N]` | Onramp URL + QR + balance poll (Tempo: hints `tempo wallet fund`) |
| `check <url> [-X method] [-d body] [-H header]...` | Probe 402 response; show accepted rails without paying |
| `pay <method> <url> [-d body] [-H header]... [--chain c] [--max-spend N] [--dry-run] [-v]` | HTTP request + auto 402 handling |
| `whoami` | Wallet + balance summary + active config |
| `history [--limit N]` | Past payments from `~/.agentscore/history.jsonl` |
| `limits show \| set \| clear` | Persistent per-call / daily / per-merchant USD spending limits |

## Funding

- **Base, Solana** — `fund` prints a [Coinbase Onramp](https://www.coinbase.com/onramp) URL (card → USDC on your chain) and an ASCII QR you can scan from any mobile wallet.
- **Tempo** — Coinbase Onramp does not cover Tempo. Use `tempo wallet fund` or transfer USDC.e (chain 4217) from an existing Tempo wallet.

The wallet holds USDC only — no ETH or SOL required. x402 (EIP-3009) and MPP Tempo are both gasless for the signer; the facilitator pays.

## Security

- Keystore is AES-256-GCM encrypted with a scrypt-derived key (`N=131072, r=8, p=1`), one file per chain.
- Files written with `0600` perms, parent dir `0700`.
- Passphrase prompted per signing operation; override with `AGENTSCORE_PAY_PASSPHRASE` env var for non-interactive agents.
- `wallet export` is guarded by `--danger` + "type EXPORT" prompt.
- Local spending limits (`limits set --daily N --per-call N --per-merchant N`) enforce at signing time via the x402 and MPP hooks.
- `~/.agentscore/history.jsonl` records successful payments (url, host, chain, protocol, status, timestamp). No secrets logged.
- No telemetry. No auto-update. No plaintext keys on disk.

## Environment

| Variable | Purpose |
|---|---|
| `AGENTSCORE_PAY_PASSPHRASE` | skip interactive passphrase prompt |
| `BASE_RPC_URL` | override Base mainnet RPC endpoint |
| `BASE_SEPOLIA_RPC_URL` | override Base Sepolia RPC endpoint |
| `SOLANA_RPC_URL` | override Solana mainnet RPC endpoint |
| `SOLANA_DEVNET_RPC_URL` | override Solana Devnet RPC endpoint |
| `TEMPO_RPC_URL` | override Tempo mainnet RPC endpoint |
| `TEMPO_TESTNET_RPC_URL` | override Tempo testnet RPC endpoint |

## Relationship to other AgentScore packages

- [`@agent-score/sdk`](https://www.npmjs.com/package/@agent-score/sdk) — TypeScript client for the AgentScore API
- [`@agent-score/gate`](https://www.npmjs.com/package/@agent-score/gate) — merchant-side trust-gating middleware
- [`@agent-score/mcp`](https://www.npmjs.com/package/@agent-score/mcp) — MCP server for AgentScore tools
- **`@agent-score/pay`** (this package) — agent-side CLI wallet across x402 and MPP rails

Wallet-to-operator linking happens merchant-side via `captureWallet` in `@agent-score/gate` — this CLI does not duplicate the `POST /v1/credentials/wallets` call.

## License

MIT
