import type { Chain, Network } from './constants';

export function faucetUrls(chain: Chain, network: Network): string[] {
  if (network !== 'testnet') return [];
  if (chain === 'base') return ['https://faucet.circle.com/', 'https://docs.base.org/docs/tools/network-faucets/'];
  if (chain === 'solana') return ['https://faucet.circle.com/', 'https://faucet.solana.com/'];
  return [];
}

export function tempoFaucetNote(): string {
  return 'Tempo testnet USDC.e: run `agentscore-pay fund --chain tempo --network testnet` — programmatically mints all 4 test stablecoins (pathUSD, AlphaUSD, BetaUSD, ThetaUSD) via the `tempo_fundAddress` JSON-RPC method. Free, no signup, no API key.';
}
