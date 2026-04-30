# @agent-score/pay

[![npm version](https://img.shields.io/npm/v/@agent-score/pay.svg)](https://www.npmjs.com/package/@agent-score/pay)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**One CLI for agent payments across the ecosystem.** Pay any 402/MPP merchant from a single shell command — natively across **x402** (Base, Solana) and **MPP** (Tempo), with structured hints to compatible clients for rails we don't fund directly (Stripe SPT via [link-cli](https://github.com/stripe/link-cli), other x402 networks).

Closes the UX gap for shell-tool LLM agents (Claude Code, Cursor, ChatGPT with Bash) that want to pay protocol-gated endpoints. Mirrors the ergonomics of `tempo request` for MPP — one shell command, body preserved, agent never sees a private key on the wire. Built and maintained by AgentScore — works with every 402-gated merchant in the ecosystem, AgentScore-gated or not. Pay does not contact AgentScore APIs unless the merchant's 402 challenge requires AgentScore identity.

## Install

```bash
# Run directly (no global install required)
npx @agent-score/pay --help

# Or install globally
npm i -g @agent-score/pay
agentscore-pay --help

# Or via the install script (auto-detects npm vs native binary)
curl -fsSL https://raw.githubusercontent.com/agentscore/pay/main/install.sh | sh

# Or via Homebrew (once the tap is published)
brew tap agentscore/tap
brew install agentscore-pay
```

Requires Node 20+ for the npm path. Native single-file binaries (no Node required) are attached to every GitHub Release via `bun run build:binary:all`.

## Quick start

```bash
# 1. One-shot init — encrypted keystores on every chain, derived from a single BIP-39 mnemonic
agentscore-pay init

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

For LLM tool-loop agents, run `agentscore-pay agent-guide` (add `--json` for parseable output) — it prints the structured how-to: golden path (init → discover → balance → check → dry-run → pay), testnet path, funding, auxiliary commands (`unlock`, `limits`, `whoami`, `history`), pitfalls, and exit-code branching. The same notes also surface in `agentscore-pay <command> --help` for `check` and `pay`.

### Output formats

Every command emits structured data. Choose your format:

| Flag | Format | Notes |
|---|---|---|
| _(default in pipes/agents)_ | TOON | token-efficient, ~40% fewer tokens than JSON |
| `--json` / `--format json` | JSON | `JSON.parse()`-safe |
| `--format yaml` | YAML | human-readable |
| `--format md` | Markdown | tables — paste into PRs / issues / docs |
| `--format jsonl` | JSON Lines | one record per line, streamable |

Other useful global flags: `--filter-output <keys>` (prune to dot-paths), `--token-count` / `--token-limit n` / `--token-offset n` (manage large outputs), `--full-output` (full envelope with `meta.command` / `meta.duration`).

When stdout is a TTY (humans), output goes pretty-printed. When piped/agent-consumed, you get the structured envelope automatically.

### Errors and exit codes

Errors emit `{ code, message, retryable, hint? }` on stderr. Exit codes are stable:

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

### MCP server (one binary, every tool)

Every command — wallet, payment, identity — is exposed as an MCP tool:

```bash
agentscore-pay --mcp                  # start as a stdio JSON-RPC MCP server
agentscore-pay mcp add                # register with Claude Code / Cursor / Amp
agentscore-pay --llms                 # markdown manifest of every command
agentscore-pay --llms --format json   # JSON Schema manifest
agentscore-pay <cmd> --schema         # JSON Schema for one command's args/options/output
```

`agentscore-pay skills add` and `agentscore-pay completions` register skill files and shell completions.

### Idempotency on retry

Every `pay` invocation generates a stable `X-Idempotency-Key` header — a SHA-256 hash of `(url + method + body + signer)` — so retries within a single invocation reuse the same key. Merchants that honor Stripe-pattern dedup won't double-charge if a payment settles but the network response is lost mid-flight. Pass your own `-H 'X-Idempotency-Key: <value>'` to override (useful for cross-process idempotency: same logical purchase across multiple `pay` invocations).

### Test-mode addresses

AgentScore reserves seven EVM addresses (`0x0000…0001` through `0x0000…0007`) as deterministic test fixtures — KYC verified, sanctions clear, age gates passing — so dev/test merchants don't burn real KYC credits. Pay exports `isAgentScoreTestAddress(addr)` from `@agent-score/pay/test-mode` and `AGENTSCORE_TEST_ADDRESSES` for completion / fixtures.

### Decimals handling

Spec-compliant 402 responses carry `decimals` in the rail requirements. When a merchant omits it, pay applies a strict policy to avoid silent mis-billing:

- **Asset is canonical USDC** (matched against the per-chain Circle USDC registry pinned in pay) — silently use 6 decimals.
- **Asset is anything else** — abort with `merchant_spec_violation`. Guessing decimals risks orders-of-magnitude mis-billing on tokens with non-6-decimal precision, so pay refuses to pay rather than continuing on partial info.

### Use from an agent — complete recipe

A typical autonomous agent flow: probe the endpoint, decide whether to pay, pay, branch on the structured outcome.

**Bash (Claude Code / Cursor / shell-tool):**

```bash
#!/usr/bin/env bash
set -eu
URL="https://agents.martinestate.com/purchase"
BODY='{"product_id":"cab-2021","quantity":1,"email":"agent@example.com","shipping":{...}}'
MAX_SPEND=250

# 1. Probe — what does this endpoint cost and which rails does it accept?
PROBE=$(agentscore-pay check "$URL" -X POST -d "$BODY" --json)
PRICE=$(printf '%s' "$PROBE" | jq -r '.accepts[0].max_amount_usd // empty')
echo "Endpoint asks for \$${PRICE} USDC"

# 2. Pay — capture stdout (success body) and exit code separately.
RESPONSE=$(agentscore-pay pay POST "$URL" \
  -H 'Content-Type: application/json' \
  -d "$BODY" \
  --max-spend "$MAX_SPEND" \
  --timeout 120 \
  --retries 2 \
  --json) || EXIT=$?
EXIT=${EXIT:-0}

# 3. Branch on the standard exit codes.
case "$EXIT" in
  0) echo "Paid. tx=$(printf '%s' "$RESPONSE" | jq -r '.tx_hash // .body.tx_hash // "?"')" ;;
  2) echo "Network/RPC error — retry later." >&2; exit 2 ;;
  3) echo "Insufficient funds — top up:"; agentscore-pay fund-estimate "$URL" -X POST -d "$BODY"; exit 3 ;;
  4) echo "Rejected (price exceeded --max-spend or local limit)." >&2; exit 4 ;;
  5) echo "Multi-rail ambiguity — set --chain or config preferred_chains." >&2; exit 5 ;;
  *) echo "User error: $RESPONSE" >&2; exit 1 ;;
esac
```

**Python:**

```python
import json, subprocess, sys

def pay(url: str, body: dict, max_spend_usd: float) -> dict:
    proc = subprocess.run(
        ["agentscore-pay", "pay", "POST", url,
         "-H", "Content-Type: application/json",
         "-d", json.dumps(body),
         "--max-spend", str(max_spend_usd),
         "--timeout", "120", "--retries", "2", "--json"],
        capture_output=True, text=True,
    )
    if proc.returncode == 0:
        return json.loads(proc.stdout)
    err = json.loads(proc.stderr.splitlines()[-1])
    raise RuntimeError(f"pay failed (exit {proc.returncode}): {err['error']['code']} — {err['error']['message']}")

result = pay("https://agents.martinestate.com/purchase",
             {"product_id": "cab-2021", "quantity": 1, "email": "a@b.co", "shipping": {}}, 250)
print(result["tx_hash"], result["body"])
```

**TypeScript / Node:**

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

async function pay(url: string, body: unknown, maxSpendUsd: number) {
  try {
    const { stdout } = await exec('agentscore-pay', [
      'pay', 'POST', url,
      '-H', 'Content-Type: application/json',
      '-d', JSON.stringify(body),
      '--max-spend', String(maxSpendUsd),
      '--timeout', '120', '--retries', '2', '--json',
    ]);
    return JSON.parse(stdout);
  } catch (err: any) {
    const last = (err.stderr ?? '').split('\n').filter(Boolean).pop();
    throw new Error(`pay exit ${err.code}: ${last}`);
  }
}
```

The CLI never touches stdout for human chrome when `--json` is passed — every byte on stdout is parseable JSON, every error on stderr is one JSON object per line.

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

Or via the CLI:

```bash
agentscore-pay config set preferred_chains tempo,base
agentscore-pay config get
agentscore-pay config unset preferred_chains
```

Verbose mode (`-v`) logs rail selection + balances to stderr.

## Commands

| Command | Purpose |
|---|---|
| `init [--no-mnemonic] [--fund-tempo-testnet] [--preferred-chains <list>]` | One-shot first-run: create all 3 wallets (mnemonic by default) + optional testnet fund + preferred-chain config |
| `wallet create [--chain c] [--wallet name] [--mnemonic]` | Generate keystore(s). Omit `--chain` to create all three. Pass `--mnemonic` to derive from a BIP-39 seed. `--wallet` for named secondary wallets. |
| `wallet import [<key>] --chain c [--wallet name]` / `wallet import --mnemonic "<phrase>"` | Import raw private key (hex/base64) OR a 12/24-word phrase |
| `wallet list [--chain c]` | List named keystores per chain |
| `wallet address --chain c [--wallet name]` | Print the address |
| `wallet export --chain c [--wallet name] --danger [--skip-confirm]` | Decrypt + print the private key |
| `wallet remove --chain c [--wallet name] --danger [--skip-confirm]` | Irrecoverably delete a keystore |
| `wallet show-mnemonic --danger [--skip-confirm]` | Decrypt + print the stored BIP-39 mnemonic |
| `balance [--chain c] [--network n]` | USDC balance across chains (mainnet default; `--network testnet` for Base Sepolia / Solana Devnet / Tempo testnet) |
| `qr --chain c [--amount N] [--network n]` | ASCII QR or EIP-681 / `solana:` URI |
| `fund --chain c [--amount N] [--network n]` | Onramp URL + QR + balance poll. Default amount is `10` USD (~50-200 typical agent calls). |
| `faucet --chain c` | Print testnet faucet URL(s) for the chain + copy your address to clipboard |
| `fund-estimate <url> [-X method] [-d body] [-H header]...` | Probe a 402-gated URL and report how many calls your balance covers + top-up suggestion |
| `check <url> [-X method] [-d body] [-H header]...` | Probe 402 response; show accepted rails without paying |
| `pay <method> <url> [-d body] [-H header]... [--chain c] [--network n] [--max-spend N] [--timeout N] [--retries N] [--dry-run] [-v]` | HTTP request + auto 402 handling. `--timeout` defaults to 60s and applies to the merchant request only — facilitator settlement may exceed it. `--retries` only retries pre-flight connection errors (per-scheme nonces prevent double-spend). |
| `whoami [--network n]` | Wallet + balance summary + active config |
| `history [--limit N]` | Past payments from `~/.agentscore/history.jsonl` |
| `limits show \| set \| clear` | Persistent per-call / daily / per-merchant USD spending limits |
| `config get [key] \| set <k> <v> \| unset <k> \| path` | Read/write `~/.agentscore/config.json` (e.g. `config set preferred_chains tempo,base`) |
| `discover [--search q] [--chain c] [--max-price N] [--limit N] [--protocol x402\|mpp\|both]` | List paid services from the x402 Bazaar (Coinbase) and MPP services directory (Tempo). Both queried in parallel by default. |
| `unlock [--for 15m] \| --clear` | Cache passphrase to `~/.agentscore/.unlock` (mode 0600) for a bounded TTL — skip per-call prompts during a session |
| `revoke --chain c --token <addr> --spender <addr> [--network n]` | Send `approve(spender, 0)` on EVM (base/tempo). Requires native gas. |

### Identity commands

`passport login`/`status`/`logout` use the public `POST /v1/sessions/public` endpoint and require **no API key**. The other identity commands below (`reputation`, `assess`, `sessions`, `credentials`, `associate-wallet`) wrap the AgentScore SDK paid tier — set `AGENTSCORE_API_KEY`.

| Command | Purpose |
|---|---|
| `passport login` | Verify your identity in browser; saves `operator_token` to `~/.agentscore/passport.json`. After login, every `pay <url>` call auto-attaches `X-Operator-Token` (suppress with `--no-passport`). No API key required. |
| `passport status` | Show stored Passport — token prefix, expiry, expired flag |
| `passport logout` | Remove the local file (and revoke remotely if `AGENTSCORE_API_KEY` is set; otherwise local-only) |
| `reputation <address> [--chain c]` | Cached trust reputation lookup (free tier) |
| `assess [--address a \| --operator-token o] [--require-kyc] [--min-age N] [--require-sanctions-clear] [--blocked-jurisdictions cc...] [--allowed-jurisdictions cc...] [--refresh]` | On-the-fly assessment with policy (paid tier) |
| `sessions create [--address a] [--operator-token o] [--context s] [--product-name s]` | Create a verification session — returns `verify_url` + `poll_secret` (low-level; `passport login` is the wrapper most agents want) |
| `sessions get <id> [--poll-secret s]` | Poll a session — returns `operator_token` once status is `verified` |
| `credentials create [--label s] [--ttl-days N]` | Mint an operator credential (`opc_...`) |
| `credentials list` | List active (non-expired) credentials |
| `credentials revoke <id>` | Revoke a credential by ID |
| `associate-wallet --operator-token o --wallet-address a --network evm\|solana [--idempotency-key k]` | Report a signer wallet seen paying under a credential (cross-merchant attribution) |

## Mnemonic-based wallets

```bash
# Generate a BIP-39 seed and derive all three chains at once
agentscore-pay wallet create --mnemonic

# Later, on another machine: import the phrase
agentscore-pay wallet import --mnemonic "legal winner thank year wave sausage worth useful legal winner thank yellow"

# Retrieve the stored phrase (prompted for passphrase + type-to-confirm)
agentscore-pay wallet show-mnemonic --danger
```

Derivation paths: EVM uses `m/44'/60'/0'/0/0` (standard), Solana uses `m/44'/501'/0'/0'` (SLIP-10 Ed25519). The same phrase regenerates identical keys on every machine.

#### Why two derivation algorithms?

EVM and Solana use **different curves**: EVM uses secp256k1 (BIP-32 hardened+non-hardened paths), Solana uses Ed25519 (which only supports hardened derivation). The standards differ accordingly:

- **EVM (BIP-44, secp256k1)** — `m/44'/60'/0'/0/0`. The trailing `/0/0` is non-hardened. MetaMask, Rabby, and Coinbase Wallet all use this path; importing a phrase into any of them yields the same address you see in `wallet address --chain base`.
- **Solana (SLIP-10, Ed25519)** — `m/44'/501'/0'/0'`. All four levels are hardened (note the trailing `'`). Phantom and Solflare use this path for "Account 0"; importing the same phrase yields the address you see in `wallet address --chain solana`.

If you import the phrase into Phantom and see a different address, check that Phantom is set to "Standard derivation path" (not the legacy `m/44'/501'/0'`).

## Multiple wallet profiles

Two layers of multi-wallet support:

### Named wallets per chain (in-place)

Each chain can hold multiple keystores. The default name is `default`; pass `--wallet <name>` to address others:

```bash
agentscore-pay wallet create --chain base --wallet trading
agentscore-pay wallet list                          # enumerate per chain
agentscore-pay balance --chain base --wallet trading
agentscore-pay pay POST <url> --chain base --wallet trading -d '...' --max-spend 5
```

Names are limited to `[a-z0-9-]` (max 32 chars). Mnemonic-derived wallets are always stored under `default` — for additional named wallets use random keys (`wallet create`) or import (`wallet import`).

#### End-to-end: separate trading + default wallets

```bash
# Default wallet for general spending
agentscore-pay init                                 # creates base/solana/tempo "default"
agentscore-pay fund --chain base --amount 10        # tops up default

# Separate "trading" wallet for a high-budget bot
agentscore-pay wallet create --chain base --wallet trading
agentscore-pay wallet address --chain base --wallet trading
# → 0xTRADINGADDRESS — fund this address externally (CEX withdrawal, transfer, etc.)
agentscore-pay balance --chain base --wallet trading

# Inspect everything
agentscore-pay wallet list
# base     default
# base     trading

# Pay from each
agentscore-pay pay POST https://merchant.example/api -d '{}' --chain base                    # uses default
agentscore-pay pay POST https://merchant.example/api -d '{}' --chain base --wallet trading   # uses trading

# Remove a wallet (irrecoverable — back up the mnemonic or export the key first)
agentscore-pay wallet export --chain base --wallet trading --danger --skip-confirm > trading.key
agentscore-pay wallet remove --chain base --wallet trading --danger --skip-confirm
```

Per-wallet limits aren't supported today (limits are global). Use separate `AGENTSCORE_PAY_HOME` profiles if you need per-wallet daily caps.

### Separate state directories

Set `AGENTSCORE_PAY_HOME` to isolate completely (different `history.jsonl`, `limits.json`, `config.json`):

```bash
# One profile for production merchants
AGENTSCORE_PAY_HOME=~/.agentscore-prod agentscore-pay wallet create

# Another profile for testnet development
AGENTSCORE_PAY_HOME=~/.agentscore-test agentscore-pay wallet create
AGENTSCORE_PAY_HOME=~/.agentscore-test agentscore-pay pay --network testnet ...
```

## Funding

The wallet holds USDC only — no ETH or SOL required. x402 (EIP-3009) and MPP Tempo are both gasless for the signer; the facilitator pays.

### Mainnet

- **Base, Solana** — `agentscore-pay fund --chain base --amount 10` prints a [Coinbase Onramp](https://www.coinbase.com/onramp) URL (card → USDC on your chain) and an ASCII QR. Click the URL, or scan the QR from any mobile wallet with USDC to send yourself a transfer. `fund` polls balance and confirms when the deposit lands. Default amount is `$10` (~50-200 typical agent calls).
- **Tempo** — Coinbase Onramp does not cover Tempo. Fund by transferring USDC.e (chain 4217) from another Tempo wallet.
- **From an existing wallet (no onramp)** — `agentscore-pay wallet address --chain base` prints the address; send USDC on Base to it from MetaMask, Rabby, Coinbase Wallet, Phantom, or a CEX withdrawal. Same pattern on Solana + Tempo.

### Testnet

| Chain | UX | Time-to-funded |
|---|---|---|
| Base Sepolia | `faucet --chain base` — prints Circle URL + copies your address to clipboard. Paste into the form and wait. | ~30s + manual paste |
| Solana Devnet | `faucet --chain solana` — same Circle flow. | ~30s + manual paste |
| **Tempo testnet** | **`fund --chain tempo --network testnet` is the only programmatic faucet** — calls Moderato's `tempo_fundAddress` JSON-RPC, mints 4 test stablecoins (pathUSD, AlphaUSD, BetaUSD, ThetaUSD) directly. No browser, no captcha. | ~5s, fully scripted |

Use `fund --chain tempo --network testnet` in CI/agent setup scripts — it's the only one that works without human interaction. Base Sepolia and Solana Devnet still require pasting your address into Circle's web form.

### Scripted / deployed agents

- Pre-fund a wallet on your laptop, then `wallet export --chain base --danger --skip-confirm` to get the key.
- On the server, `AGENTSCORE_PAY_PASSPHRASE=<pass> agentscore-pay wallet import --chain base 0x<hex>` or ship the encrypted `~/.agentscore/wallets/base.json` directly.
- `AGENTSCORE_PAY_HOME=/opt/agentscore` in the server env isolates state from any other user on the machine.
- `agentscore-pay limits set --daily 50 --per-call 1` caps spending for autonomous agents.

### Budgeting for a specific merchant

```bash
# Before making a purchase, check what you can afford
agentscore-pay fund-estimate https://agents.martinestate.com/purchase \
  -X POST -d '{"product_id":"cab-2021","quantity":1,...}'
# → shows price, your balance, calls affordable, and suggested top-up
```

## Security

- Keystore is AES-256-GCM encrypted with a scrypt-derived key (`N=131072, r=8, p=1`), one file per chain.
- Files written with `0600` perms, parent dir `0700`.
- Passphrase prompted per signing operation; override with `AGENTSCORE_PAY_PASSPHRASE` env var for non-interactive agents.
- `wallet export` is guarded by `--danger` + "type EXPORT" prompt.
- Local spending limits (`limits set --daily N --per-call N --per-merchant N`) enforce at signing time via the x402 and MPP hooks.
- `~/.agentscore/history.jsonl` records successful payments (url, host, chain, protocol, status, timestamp). No secrets logged.
- No telemetry. No auto-update. No plaintext keys on disk.

### Passphrase strength

For **interactive humans**: any 8+ char passphrase you'll remember is fine — the scrypt-256-GCM combination is robust against offline brute force at typical human-passphrase entropy levels.

For **autonomous agents**: the passphrase usually lives in `AGENTSCORE_PAY_PASSPHRASE` (env var) or `~/.agentscore/.unlock` (file). Both are filesystem/process-readable to anyone with shell access as that user, so the passphrase isn't really a separate trust boundary — it's primarily protecting the keystore against *theft of the on-disk file alone*. A long, random passphrase makes the file useless if exfiltrated:

```sh
# generate a 32-byte (256-bit) random passphrase
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# 4d2a...

# stash it where your agent can read it (env / secret manager / .env / etc.)
export AGENTSCORE_PAY_PASSPHRASE=4d2a...
```

If the wallet keystore *and* the passphrase store are both compromised, the wallet is compromised — there's no extra protection from a complex passphrase. Defend the directory.

### Verifying release binaries (sigstore / cosign)

Native binaries attached to each [GitHub Release](https://github.com/agentscore/pay/releases) are signed with [sigstore/cosign](https://docs.sigstore.dev/cosign/overview/) keyless OIDC. To verify a downloaded binary:

```sh
cosign verify-blob \
  --signature agentscore-pay-darwin-arm64.sig \
  --certificate agentscore-pay-darwin-arm64.pem \
  --certificate-identity-regexp 'https://github.com/agentscore/.+' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  agentscore-pay-darwin-arm64
```

A successful verification (`Verified OK`) confirms the binary was built by a workflow in the `agentscore` GitHub org against the published source — not tampered post-build. The `.sig` and `.pem` files are uploaded next to each binary in the release.

The npm package itself is published with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) (also sigstore-backed) — `npm install @agent-score/pay` inherits the same trust chain automatically.

## Environment

| Variable | Purpose |
|---|---|
| `AGENTSCORE_PAY_PASSPHRASE` | skip interactive passphrase prompt |
| `AGENTSCORE_PAY_HOME` | override state dir (default `~/.agentscore`) — lets you run multiple wallet profiles |
| `BASE_RPC_URL` | override Base mainnet RPC endpoint |
| `BASE_SEPOLIA_RPC_URL` | override Base Sepolia RPC endpoint |
| `SOLANA_RPC_URL` | override Solana mainnet RPC endpoint |
| `SOLANA_DEVNET_RPC_URL` | override Solana Devnet RPC endpoint |
| `TEMPO_RPC_URL` | override Tempo mainnet RPC endpoint |
| `TEMPO_TESTNET_RPC_URL` | override Tempo testnet RPC endpoint |
| `AGENTSCORE_API_KEY` | API key for identity commands (`assess`, `sessions`, `credentials`, `associate-wallet`, `reputation`) |

## Relationship to other AgentScore packages

`@agent-score/pay` is the universal agent-payment CLI; it works with any 402/MPP merchant regardless of whether they use AgentScore for identity. The packages below are AgentScore's optional identity + integration layer for merchants who choose to use it:

- [`@agent-score/sdk`](https://www.npmjs.com/package/@agent-score/sdk) — TypeScript client for the AgentScore API
- [`@agent-score/commerce`](https://www.npmjs.com/package/@agent-score/commerce) — merchant-side SDK: trust-gating middleware (`/identity/{hono,express,fastify,nextjs,web}`) plus 402 / payment / discovery / Stripe-multichain helpers
- **`@agent-score/pay`** (this package) — agent-side CLI: wallet + payment across x402/MPP rails + identity commands (assess, sessions, credentials, associate-wallet, reputation). Doubles as an MCP server via `--mcp`.

When a merchant uses `@agent-score/commerce`, wallet-to-operator linking happens merchant-side via `captureWallet` — pay does not duplicate the `POST /v1/credentials/wallets` call. For non-AgentScore merchants this is a no-op; pay does not contact AgentScore APIs unless the merchant's 402 challenge requires AgentScore identity.

## License

MIT
