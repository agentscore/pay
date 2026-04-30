# Changelog

## Unreleased

### Added

- **`passport` command group** (`passport login`, `passport status`, `passport logout`) — AgentScore Passport (buyer-side identity) wraps the lower-level `sessions create` + `sessions get` flow into one browser-redirect login. Stores the resulting `operator_token` at `~/.agentscore/passport.json` (mode 0600).
- **Auto-attach** — every `pay <url>` settle leg now reads the stored Passport and adds `X-Operator-Token` automatically when present. Caller-supplied `-H "X-Operator-Token: ..."` always wins; `--no-passport` opts out for explicit-anonymous traffic.
- **`--no-passport` flag on `pay`** for explicit anonymous calls.
- **Soft + hard expiry warnings** on stderr — Passports within 5 days of expiry print a renewal hint; expired Passports surface a `pay passport login` next-step. Phase 2 (cold-start auto-bootstrap + smooth mid-stream reauth) and Phase 3 (refresh tokens) follow on this branch.
- **MCP tools** auto-registered from the new commands: `passport_login`, `passport_status`, `passport_logout`.
- **New error codes**: `passport_api_error`, `passport_verification_failed`, `passport_verification_timeout`, `passport_token_expired` (mapped to existing exit-code categories).

## 0.1.0-rc.8

### Breaking

- **CLI framework migration: commander → [incur](https://github.com/wevm/incur).** Every command is now a typed handler returning data; `incur` owns formatting (TOON by default, JSON / YAML / Markdown table / JSONL on demand) and exposes the same surface as a stdio MCP server (`agentscore-pay --mcp`) and an LLM-readable manifest (`agentscore-pay --llms`).
- **One binary for the agent surface.** Identity tools (`assess`, `sessions create/get`, `credentials create/list/revoke`, `associate-wallet`, `reputation`) ship as first-class commands and are exposed automatically via `--mcp`. Wallet + payment + identity all in one CLI.
- **`--plain` flag removed.** Output adapts to TTY automatically; pipe / redirect → structured envelope, terminal → pretty. Replace `--plain` callsites with `--format toon` (default in pipes anyway) or `--format json`.
- **Removed packages:** `commander`, `picocolors`. Removed source modules: `src/output.ts`, `src/mode.ts`, `src/colors.ts`. Tests that asserted on `process.stdout.write` spies have been rewritten to assert on returned data.

### Added

- **Identity commands:** `reputation`, `assess`, `sessions create/get`, `credentials create/list/revoke`, `associate-wallet`. Read API key from `AGENTSCORE_API_KEY` (or `--api-key` per command). All errors map to structured `CliError` codes with stable exit codes.
- **`--mcp` mode:** `agentscore-pay --mcp` runs as a stdio JSON-RPC MCP server exposing all 36 commands as tools (wallet + payment + identity). `agentscore-pay mcp add` registers the CLI with Claude Code / Cursor / Amp.
- **`--llms` manifest:** Markdown by default, JSON Schema with `--llms --format json`. Per-command `--schema` exports JSON Schema for args/options/output.
- **Output controls:** `--format toon|json|yaml|md|jsonl`, `--filter-output <keys>` (dot-paths + array slices), `--token-count` / `--token-limit n` / `--token-offset n` for managing large outputs, `--full-output` for the full envelope.
- **Stdout discipline:** every byte on stdout is the structured result; progress events go to stderr only. CliError → IncurError bridge so `code`, `exitCode`, and `hint` flow through every output path uniformly.

### Fixed

- `loadKeystore` now wraps ENOENT into `CliError('no_wallet')` (exit 3) instead of bubbling a raw filesystem error as `code: "UNKNOWN"`. Pre-migration this was implicit; now it matches the documented exit-code table.

### Notes

- All 17 existing commands (`init`, `wallet *`, `balance`, `qr`, `fund`, `fund-estimate`, `faucet`, `pay`, `check`, `discover`, `whoami`, `history`, `limits *`, `config *`, `unlock`, `revoke`, `agent-guide`) preserve their previous behavior; only the underlying CLI framework changed.
- 272/274 tests pass (2 testnet integration tests skip when `EVM_KEY` / `SVM_KEY` env vars unset). Lint, typecheck, build all green.
