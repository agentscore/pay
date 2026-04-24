# Integration tests

Real-network tests that require testnet funds. Skipped unless the relevant
`PRIVATE_KEY` env vars are set.

## Running

```bash
export BASE_SEPOLIA_PRIVATE_KEY=0x...   # funded Base Sepolia wallet (USDC)
export SOLANA_DEVNET_PRIVATE_KEY=...    # funded Solana Devnet wallet (USDC)
export TEMPO_TESTNET_PRIVATE_KEY=0x...  # funded Tempo testnet wallet (USDC.e)

bun run test:integration
```

Tests that have no funding configured are skipped rather than failing, so CI
can run them on a best-effort basis.

## Funding

- Base Sepolia USDC: https://faucet.circle.com/
- Solana Devnet USDC: https://faucet.circle.com/
- Tempo testnet USDC.e: contact Tempo team

## What's covered

- `tests/integration/balance.test.ts` — reads balance against each testnet
- (future) `tests/integration/pay.test.ts` — completes a real 402 payment round-trip
  against an x402 demo endpoint on Base Sepolia + Solana Devnet
