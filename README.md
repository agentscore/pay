# @agent-score/x402

CLI wallet for one-shell-command x402 payments on Base and Solana.

Closes the UX gap for shell-tool LLM agents (Claude Code, Cursor, ChatGPT with Bash) that want to pay x402-gated endpoints. Mirrors the ergonomics of `tempo request` for MPP: one command, body preserved, agent never sees a private key on the wire.

## Install

```bash
# Run directly (no global install required)
npx @agent-score/x402 --help

# Or install globally
npm i -g @agent-score/x402
agentscore-x402 --help
```

Requires Node 20+.

## Quick start

```bash
# 1. Create an encrypted local keystore
agentscore-x402 wallet create --chain base

# 2. Fund it (prints Coinbase Onramp URL + QR + polls balance)
agentscore-x402 fund --chain base --amount 10

# 3. Pay an x402 endpoint — body is preserved through the 402 round-trip
agentscore-x402 pay POST https://agents.martinestate.com/purchase \
  -H 'Content-Type: application/json' \
  -d '{"product_id":"cabernet-sauvignon-2021","quantity":1,"email":"a@b.co","shipping":{...}}' \
  --max-spend 250
```

Works the same on Solana:

```bash
agentscore-x402 wallet create --chain solana
agentscore-x402 fund --chain solana --amount 10
agentscore-x402 pay POST https://merchant.example/api --chain solana -d '...' --max-spend 5
```

## Commands

| Command | Purpose |
|---|---|
| `wallet create [--chain base\|solana]` | Generate a new keystore (AES-256-GCM + scrypt) at `~/.agentscore/wallets/<chain>.json` |
| `wallet import <key> [--chain base\|solana]` | Import an existing key (hex for base, base64 keypair for solana) |
| `wallet address [--chain base\|solana]` | Print the address |
| `balance [--chain base\|solana]` | Show USDC balance across configured chains |
| `qr [--chain base\|solana] [--amount N]` | Terminal ASCII QR for receiving USDC (raw address or [EIP-681](https://eips.ethereum.org/EIPS/eip-681) / `solana:` URI when amount is set) |
| `fund [--chain base\|solana] [--amount N]` | Print Coinbase Onramp URL + QR, poll balance until deposit lands |
| `pay <METHOD> <URL> [-d body] [-H 'Name: value']... [--chain c] [--max-spend N] [-v]` | Send HTTP request, auto-handle x402 402 → sign → retry |

## Funding

The wallet holds USDC only — no ETH or SOL required. x402 payments use EIP-3009 (Base) and SPL Token (Solana), both of which are gasless for the signer; the facilitator pays gas.

`fund` prints a [Coinbase Onramp](https://www.coinbase.com/onramp) URL (card → USDC on your chain) and an ASCII QR you can scan from any mobile wallet. If you already have USDC elsewhere, just transfer to the address.

## Security

- Keystore is AES-256-GCM encrypted with a scrypt-derived key (`N=131072, r=8, p=1`).
- Files are written with `0600` permissions, parent dir `0700`.
- Passphrase is prompted per signing operation unless `AGENTSCORE_X402_PASSPHRASE` is set in the environment (useful for autonomous agents).
- No telemetry. No auto-update. No plaintext keys on disk.

## Supported chains (MVP)

- **Base mainnet** — `eip155:8453`, USDC `0x8335...2913`, via CDP facilitator
- **Solana mainnet** — `solana:5eykt...`, USDC `EPjF...Dt1v`, via CDP facilitator

Polygon / Arbitrum / World / Tempo / additional chains land in a polish follow-up.

## Relationship to other AgentScore packages

- [`@agent-score/sdk`](https://www.npmjs.com/package/@agent-score/sdk) — TypeScript client for the AgentScore API
- [`@agent-score/gate`](https://www.npmjs.com/package/@agent-score/gate) — merchant-side trust-gating middleware
- [`@agent-score/mcp`](https://www.npmjs.com/package/@agent-score/mcp) — MCP server for AgentScore tools
- **`@agent-score/x402`** (this package) — agent-side CLI wallet for x402 rails

Wallet-to-operator linking happens merchant-side via `captureWallet` in `@agent-score/gate` — this CLI does not duplicate the `POST /v1/credentials/wallets` call.

## License

MIT
