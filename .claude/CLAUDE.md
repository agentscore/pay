# @agent-score/pay

CLI wallet for one-shell-command agent payments across x402 (Base) and MPP (Tempo, Solana). ESM-only.

## Purpose

One shell command for shell-tool LLM agents to pay any 402/MPP merchant. POST body preserved through the round-trip; agent never sees a private key on the wire. Works with any 402-gated merchant — AgentScore-gated or not.

## Architecture

Single-package TypeScript CLI published to npm. Runnable via `npx @agent-score/pay`.

| File | Purpose |
|------|---------|
| `src/index.ts` | Shebang + error handler, entry point for the `agentscore-pay` bin |
| `src/cli.ts` | incur Cli definition (zod-typed args/options, structured envelopes, built-in `--mcp` / `--llms`) |
| `src/keystore.ts` | AES-256-GCM + scrypt encrypted keystore (generic, chain-agnostic) |
| `src/wallets.ts` | Wallet factory dispatching to chain modules |
| `src/prompts.ts` | Passphrase input (respects `AGENTSCORE_PAY_PASSPHRASE` env) |
| `src/constants.ts` | Chain network IDs, USDC addresses, RPC URLs |
| `src/chains/base.ts` | EVM adapter (x402): viem Account, USDC balance, EIP-681 QR URI |
| `src/chains/solana.ts` | SVM adapter (MPP `solana/charge`): `@solana/kit` KeyPairSigner, SPL balance, `solana:` URI |
| `src/chains/tempo.ts` | EVM adapter (MPP): viem Account on chain 4217, USDC.e balance, EIP-681 QR URI |
| `src/commands/wallet.ts` | `wallet create/import/address/list/remove/export/show-mnemonic` |
| `src/commands/balance.ts` | `balance` across chains |
| `src/commands/qr.ts` | `qr` with optional amount |
| `src/commands/fund.ts` | `fund` — receive QR + balance polling (default); `--via stripe-onramp` mints a Stripe Crypto Onramp session (base/solana mainnet only); `--quote-only` returns the Stripe price preview without minting. Tempo testnet uses programmatic mint via tempo_fundAddress. |
| `src/onramp.ts` | API client for the AgentScore Crypto Onramp endpoints (POST /v1/onramp/sessions + POST /v1/onramp/quotes). Sends X-Client-Id + the stored passport operator_token in the body — no merchant API key required. |
| `src/commands/pay.ts` | `pay <METHOD> <URL>` — routes to `@x402/fetch` (base) or `mppx/client` (tempo, solana via `@solana/mpp/client`). `--identity auto\|operator\|wallet` selects the identity to present (`operator` uses the stored passport operator_token; `wallet` uses the wallet address; `auto` is the default passport/wallet path). |
| `src/commands/identity.ts` | `reputation`, `assess`, `sessions create/get`, `credentials create/list/revoke`, `associate-wallet` (wraps `@agent-score/sdk`) |
| `src/commands/send.ts` | `send --chain <chain> --to <addr> --amount <n> [--asset usdc\|native]` — raw transfer (no merchant / 402). Default `--asset usdc` (ERC20 transfer on EVM / SPL transferChecked + idempotent ATA on Solana). `--asset native` sends ETH/TEMPO/SOL via viem sendTransaction (EVM) or `getTransferSolInstruction` (Solana). EVM transfers confirm the on-chain receipt (`src/chains/evm-confirm.ts`) and surface a reverted tx as `transfer_reverted` instead of returning a hash for a tx that never settled. Note Tempo pays the network fee in the stablecoin itself, so a full-balance USDC send reverts (no headroom for the fee); leave a little `--amount` headroom. Works on mainnet + testnet (`--network testnet`). |
| `src/commands/passport.ts` | `passport login/status/logout` — AgentScore Passport (buyer-side identity); stores opc_ at `~/.agentscore/passport.json`, auto-attached on `agentscore-pay <url>` settle leg |
| `src/passport/{auth,storage,attach}.ts` | Passport login flow (mint+poll), conf-style local keystore, X-Operator-Token attach decision tree |
| `src/progress.ts` | stderr-only structured progress events (stdout belongs to incur) |
| `tests/` | Vitest unit tests |
| `dist/` | tsup output — ESM only with shebang banner |

## Chain-to-protocol routing

- `base` → x402Client + ExactEvmScheme, via `wrapFetchWithPayment`
- `tempo` → `Mppx.create({ methods: [tempo({ account })] })`, via mpp.fetch
- `solana` → `Mppx.create({ methods: [solanaCharge({ signer, rpcUrl })] })` from `@solana/mpp/client`, via mpp.fetch

Both paths preserve POST bodies through the 402 round-trip. The CLI's passphrase + keystore layer is chain-agnostic.

## Tooling

- **Bun** — package manager. Use `bun install`, `bun run <script>`.
- **ESLint 9** — linting. `bun run lint`.
- **tsup** — builds ESM with `#!/usr/bin/env node` banner. `bun run build`.
- **Vitest** — tests. `bun run test`.
- **knip** — dead-code check. `bun run knip` (src/aip/ excluded: dormant surface kept for re-enable).
- **Lefthook** — git hooks. Pre-commit: lint. Pre-push: typecheck.

## Patched dependencies

`patches/incur@<version>.patch` rewrites incur's `dist/Mcp.js` so the two MCP
transport specifiers are literal dynamic imports. Bun's compile tracing cannot
follow incur's `importModule = (specifier) => import(specifier)` indirection, so
without it the compiled binary cannot resolve the stdio transport, while the
node dist works fine. Rebase the patch at every incur bump and drop it once
incur emits literal specifiers.

Keep the patch to the `dist/Mcp.js` hunk only. `bun patch --commit` also records
deletions of example `.bin` symlinks that exist in bun's cache copy but not in
`node_modules`, and their paths embed a local home directory; trim those by hand.

Because the binary is what breaks, verify an incur change against the **compiled
binary**, not the node dist: build it, check `--version` reports the injected
version rather than `0.0.0-dev`, and run an MCP `initialize` plus `tools/list`
handshake through it.

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
