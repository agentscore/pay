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

Requires Node 20+.

## Quick start

```bash
# 1. Create an encrypted local keystore (pick your chain)
agentscore-pay wallet create --chain base

# 2. Fund it (Coinbase Onramp URL + QR; Tempo uses `tempo wallet fund`)
agentscore-pay fund --chain base --amount 10

# 3. Pay — body preserved through the 402 round-trip
agentscore-pay pay POST https://agents.martinestate.com/purchase \
  -H 'Content-Type: application/json' \
  -d '{"product_id":"cabernet-sauvignon-2021","quantity":1,"email":"a@b.co","shipping":{...}}' \
  --max-spend 250
```

Same flow on Solana or Tempo — just change `--chain`:

```bash
agentscore-pay wallet create --chain solana
agentscore-pay pay POST https://merchant.example/api --chain solana -d '...' --max-spend 5

agentscore-pay wallet create --chain tempo
agentscore-pay pay POST https://agents.martinestate.com/purchase --chain tempo -d '...' --max-spend 250
```

## Rails

| Chain | Protocol | Library | Network |
|---|---|---|---|
| `base` | x402 (EIP-3009) | `@x402/fetch` + `@x402/evm` | `eip155:8453` |
| `solana` | x402 (SPL Token) | `@x402/fetch` + `@x402/svm` | `solana:5eykt...` |
| `tempo` | MPP | `mppx/client` | chain 4217 |

## Commands

| Command | Purpose |
|---|---|
| `wallet create [--chain c]` | Generate keystore (AES-256-GCM + scrypt) at `~/.agentscore/wallets/<chain>.json` |
| `wallet import <key> [--chain c]` | Import an existing key (hex for EVM chains, base64 for Solana) |
| `wallet address [--chain c]` | Print the address |
| `balance [--chain c]` | Show USDC balance across configured chains |
| `qr [--chain c] [--amount N]` | Terminal ASCII QR for receiving USDC |
| `fund [--chain c] [--amount N]` | Print Coinbase Onramp URL + QR, poll balance (Tempo: prints `tempo wallet fund` hint) |
| `pay <METHOD> <URL> [-d body] [-H 'Name: value']... [--chain c] [--max-spend N] [-v]` | HTTP request + auto-handle 402 → sign → retry |

## Funding

- **Base, Solana** — `fund` prints a [Coinbase Onramp](https://www.coinbase.com/onramp) URL (card → USDC on your chain) and an ASCII QR you can scan from any mobile wallet.
- **Tempo** — Coinbase Onramp does not cover Tempo. Use `tempo wallet fund` or transfer USDC.e (chain 4217) from an existing Tempo wallet.

The wallet holds USDC only — no ETH or SOL required. Both x402 rails and MPP/Tempo are gasless for the signer (the facilitator pays).

## Security

- Keystore is AES-256-GCM encrypted with a scrypt-derived key (`N=131072, r=8, p=1`), one file per chain.
- Files are written with `0600` permissions, parent dir `0700`.
- Passphrase is prompted per signing operation unless `AGENTSCORE_X402_PASSPHRASE` is set (useful for autonomous agents).
- No telemetry. No auto-update. No plaintext keys on disk.

## Relationship to other AgentScore packages

- [`@agent-score/sdk`](https://www.npmjs.com/package/@agent-score/sdk) — TypeScript client for the AgentScore API
- [`@agent-score/gate`](https://www.npmjs.com/package/@agent-score/gate) — merchant-side trust-gating middleware
- [`@agent-score/mcp`](https://www.npmjs.com/package/@agent-score/mcp) — MCP server for AgentScore tools
- **`@agent-score/pay`** (this package) — agent-side CLI wallet across x402 and MPP rails

Wallet-to-operator linking happens merchant-side via `captureWallet` in `@agent-score/gate` — this CLI does not duplicate the `POST /v1/credentials/wallets` call.

## License

MIT
