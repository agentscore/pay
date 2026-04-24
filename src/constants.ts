export const SUPPORTED_CHAINS = ['base', 'solana'] as const;
export type Chain = (typeof SUPPORTED_CHAINS)[number];

export const USDC = {
  base: {
    mainnet: {
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const,
      decimals: 6,
      rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
      network: 'eip155:8453' as const,
      chainId: 8453,
    },
    sepolia: {
      address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const,
      decimals: 6,
      rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
      network: 'eip155:84532' as const,
      chainId: 84532,
    },
  },
  solana: {
    mainnet: {
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      decimals: 6,
      rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
      network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const,
    },
    devnet: {
      mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      decimals: 6,
      rpcUrl: process.env.SOLANA_DEVNET_RPC_URL || 'https://api.devnet.solana.com',
      network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' as const,
    },
  },
} as const;

export function onrampUrl(chain: Chain, address: string, amountUsd?: number): string {
  const network = chain === 'base' ? 'base' : 'solana';
  const asset = 'USDC';
  const base = 'https://pay.coinbase.com/buy/select-asset';
  const params = new URLSearchParams({
    defaultAsset: asset,
    defaultNetwork: network,
    addresses: JSON.stringify({ [address]: [network] }),
  });
  if (amountUsd && amountUsd > 0) params.set('presetFiatAmount', String(amountUsd));
  return `${base}?${params.toString()}`;
}
