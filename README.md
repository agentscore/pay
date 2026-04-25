# @agent-score/pay

[![npm version](https://img.shields.io/npm/v/@agent-score/pay.svg)](https://www.npmjs.com/package/@agent-score/pay)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

CLI wallet for one-shell-command agent payments across **x402** (Base, Solana) and **MPP** (Tempo).

Closes the UX gap for shell-tool LLM agents (Claude Code, Cursor, ChatGPT with Bash) that want to pay protocol-gated endpoints. Mirrors the ergonomics of `tempo request` for MPP — one shell command, body preserved, agent never sees a private key on the wire — but works across every rail an AgentScore-gated merchant might accept.

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
- **Tempo** — Coinbase Onramp does not cover Tempo. Use `tempo wallet fund` or transfer USDC.e (chain 4217) from an existing Tempo wallet.
- **From an existing wallet (no onramp)** — `agentscore-pay wallet address --chain base` prints the address; send USDC on Base to it from MetaMask, Rabby, Coinbase Wallet, Phantom, or a CEX withdrawal. Same pattern on Solana + Tempo.

### Testnet

- `agentscore-pay faucet --chain base` prints the Circle USDC faucet URL + the Base Sepolia address (copied to clipboard). Paste into the faucet form and wait.
- Same flow for `--chain solana` (Solana Devnet).
- **`agentscore-pay fund --chain tempo --network testnet`** is one-shot: it calls Moderato's `tempo_fundAddress` JSON-RPC and mints 4 test stablecoins (pathUSD, AlphaUSD, BetaUSD, ThetaUSD) directly to the wallet. No browser, no captcha, no install.

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

## Relationship to other AgentScore packages

- [`@agent-score/sdk`](https://www.npmjs.com/package/@agent-score/sdk) — TypeScript client for the AgentScore API
- [`@agent-score/gate`](https://www.npmjs.com/package/@agent-score/gate) — merchant-side trust-gating middleware
- [`@agent-score/mcp`](https://www.npmjs.com/package/@agent-score/mcp) — MCP server for AgentScore tools
- **`@agent-score/pay`** (this package) — agent-side CLI wallet across x402 and MPP rails

Wallet-to-operator linking happens merchant-side via `captureWallet` in `@agent-score/gate` — this CLI does not duplicate the `POST /v1/credentials/wallets` call.

## License

MIT
