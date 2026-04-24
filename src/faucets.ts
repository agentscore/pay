import type { Chain, Network } from './constants';

export function faucetUrls(chain: Chain, network: Network): string[] {
  if (network !== 'testnet') return [];
  if (chain === 'base') return ['https://faucet.circle.com/', 'https://docs.base.org/docs/tools/network-faucets/'];
  if (chain === 'solana') return ['https://faucet.circle.com/', 'https://faucet.solana.com/'];
  return [];
}

export function tempoFaucetNote(): string {
  return 'Tempo testnet USDC.e: contact the Tempo team or use `tempo wallet fund --testnet`.';
}
