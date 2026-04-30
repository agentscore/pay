# @agent-score/pay

CLI wallet for one-shell-command agent payments across x402 (Base, Solana) and MPP (Tempo). ESM-only.

## Purpose

Closes the UX gap for shell-tool LLM agents that want to pay protocol-gated endpoints. Mirrors `tempo request` ergonomics but covers every rail any 402/MPP merchant might accept: one shell command, body preserved, agent never sees a private key on the wire. Built by AgentScore; works with any 402-gated merchant — AgentScore-gated or not. Brand-as-maker stays prominent (binary name `agentscore-pay`, package `@agent-score/pay`); brand-as-scope explicitly does not — pay is the universal agent-payment CLI for the ecosystem.

## Architecture

Single-package TypeScript CLI published to npm. Runnable via `npx @agent-score/pay`.

| File | Purpose |
|------|---------|
| `src/index.ts` | Shebang + error handler, entry point for the `agentscore-pay` bin |
| `src/cli.ts` | incur Cli definition (zod-typed args/options, structured envelopes, built-in `--mcp` / `--llms`) |
| `src/keystore.ts` | AES-256-GCM + scrypt encrypted keystore (generic, chain-agnostic) |
| `src/wallets.ts` | Wallet factory dispatching to chain modules |
| `src/prompts.ts` | Passphrase input (respects `AGENTSCORE_PAY_PASSPHRASE` env) |
| `src/constants.ts` | Chain network IDs, USDC addresses, RPC URLs, Coinbase Onramp builder |
| `src/chains/base.ts` | EVM adapter (x402): viem Account, USDC balance, EIP-681 QR URI |
| `src/chains/solana.ts` | SVM adapter (x402): `@solana/kit` KeyPairSigner, SPL balance, `solana:` URI |
| `src/chains/tempo.ts` | EVM adapter (MPP): viem Account on chain 4217, USDC.e balance, EIP-681 QR URI |
| `src/commands/wallet.ts` | `wallet create/import/address/list/remove/export/show-mnemonic` |
| `src/commands/balance.ts` | `balance` across chains |
| `src/commands/qr.ts` | `qr` with optional amount |
| `src/commands/fund.ts` | `fund` — onramp link + QR + balance polling (Tempo testnet uses programmatic mint) |
| `src/commands/pay.ts` | `pay <METHOD> <URL>` — routes to `@x402/fetch` (base/solana) or `mppx/client` (tempo) |
| `src/commands/identity.ts` | `reputation`, `assess`, `sessions create/get`, `credentials create/list/revoke`, `associate-wallet` (wraps `@agent-score/sdk`) |
| `src/commands/passport.ts` | `passport login/status/logout` — AgentScore Passport (buyer-side identity); stores opc_ at `~/.agentscore/passport.json`, auto-attached on `pay <url>` settle leg |
| `src/passport/{auth,storage,attach}.ts` | Passport login flow (mint+poll), conf-style local keystore, X-Operator-Token attach decision tree |
| `src/progress.ts` | stderr-only structured progress events (stdout belongs to incur) |
| `tests/` | Vitest unit tests |
| `dist/` | tsup output — ESM only with shebang banner |

## Chain-to-protocol routing

- `base` / `solana` → x402Client + ExactEvmScheme or ExactSvmScheme, via `wrapFetchWithPayment`
- `tempo` → `Mppx.create({ methods: [tempo({ account })] })`, via mpp.fetch

Both paths preserve POST bodies through the 402 round-trip. The CLI's passphrase + keystore layer is chain-agnostic.

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

npm scope is `@agent-score`. User-Agent in payment payloads uses `@agentscore/pay`.

## Scope boundary

- **In scope (MVP):** pay, balance, qr, fund, wallet CRUD on Base + Solana + Tempo
- **Full polish (post-MVP):** Polygon/Arbitrum/World, BIP-39, keychain, `history/check/whoami/limits/link`, Coinbase Pay SDK embed, Homebrew/Scoop/Docker, sigstore, native binary
- **Out forever:** fiat onramp, custodial wallet, swaps/bridges, GUI, duplicating merchant-side wallet capture
