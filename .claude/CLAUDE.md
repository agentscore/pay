# @agent-score/x402

CLI wallet for one-shell-command x402 payments on Base and Solana. ESM-only.

## Purpose

Closes the UX gap for shell-tool LLM agents that want to pay x402-gated endpoints. Mirrors `tempo request` ergonomics for MPP: one shell command, body preserved, agent never sees a private key on the wire.

## Architecture

Single-package TypeScript CLI published to npm. Runnable via `npx @agent-score/x402`.

| File | Purpose |
|------|---------|
| `src/index.ts` | Shebang + error handler, entry point for the `agentscore-x402` bin |
| `src/cli.ts` | commander program definition |
| `src/keystore.ts` | AES-256-GCM + scrypt encrypted keystore (generic, chain-agnostic) |
| `src/wallets.ts` | Wallet factory dispatching to chain modules |
| `src/prompts.ts` | Passphrase input (respects `AGENTSCORE_X402_PASSPHRASE` env) |
| `src/constants.ts` | Chain network IDs, USDC addresses, RPC URLs, Coinbase Onramp builder |
| `src/chains/base.ts` | EVM adapter: viem Account, USDC balance, EIP-681 QR URI |
| `src/chains/solana.ts` | SVM adapter: `@solana/kit` KeyPairSigner, SPL balance, `solana:` URI |
| `src/commands/wallet.ts` | `wallet create/import/address` |
| `src/commands/balance.ts` | `balance` across chains |
| `src/commands/qr.ts` | `qr` with optional amount |
| `src/commands/fund.ts` | `fund` — onramp link + QR + balance polling |
| `src/commands/pay.ts` | `pay <METHOD> <URL>` — wraps `@x402/fetch` with EVM or SVM scheme |
| `tests/` | Vitest unit tests (keystore + QR URI shape) |
| `dist/` | tsup output — ESM only with shebang banner |

## Tooling

- **Bun** — package manager. Use `bun install`, `bun run <script>`.
- **ESLint 9** — linting. `bun run lint`.
- **tsup** — builds ESM with `#!/usr/bin/env node` banner. `bun run build`.
- **Vitest** — tests. `bun run test`.
- **Lefthook** — git hooks. Pre-commit: lint. Pre-push: typecheck.

## Key Commands

```bash
bun install
bun run dev -- wallet create --chain base   # run via tsx in-place
bun run lint
bun run typecheck
bun run test
bun run build
```

## Workflow

1. Create a branch
2. Make changes
3. Lefthook runs lint on commit, typecheck on push
4. Open a PR — CI runs automatically
5. Merge (squash)

## Rules

- **No silent refactors**
- **Never commit .env files or secrets**
- **Use PRs** — never push directly to main

## Releasing

1. Update `version` in `package.json`
2. Commit: `git commit -am "chore: bump to vX.Y.Z"`
3. Tag: `git tag vX.Y.Z`
4. Push: `git push && git push origin vX.Y.Z`

The publish workflow runs on `ubuntu-latest` (required for npm trusted publishing), builds, publishes to npm with provenance, and creates a GitHub Release.

npm scope is `@agent-score`. User-Agent in x402 payloads uses `@agentscore/x402`.

## Scope boundary

- **In scope:** pay, balance, qr, fund, wallet CRUD on Base + Solana
- **Full polish (TEC-232):** Polygon/Arbitrum/World/Tempo, BIP-39, keychain, `history/check/whoami/limits/link`, Coinbase Pay SDK embed, Homebrew/Scoop/Docker, sigstore, native binary
- **Out forever:** fiat onramp, custodial wallet, swaps/bridges, GUI, duplicating merchant-side wallet capture
