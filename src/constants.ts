export const SUPPORTED_CHAINS = ['base', 'solana', 'tempo'] as const;
export type Chain = (typeof SUPPORTED_CHAINS)[number];

export const SUPPORTED_NETWORKS = ['mainnet', 'testnet'] as const;
export type Network = (typeof SUPPORTED_NETWORKS)[number];

const DEFAULT_RPC = {
  base_mainnet: 'https://mainnet.base.org',
  base_sepolia: 'https://sepolia.base.org',
  solana_mainnet: 'https://api.mainnet-beta.solana.com',
  solana_devnet: 'https://api.devnet.solana.com',
  tempo_mainnet: 'https://rpc.tempo.xyz',
  tempo_testnet: 'https://rpc.moderato.tempo.xyz',
} as const;

function rpcUrl(envKey: string, fallback: string): string {
  return process.env[envKey] ?? fallback;
}

export const USDC = {
  base: {
    mainnet: {
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const,
      decimals: 6,
      network: 'eip155:8453' as const,
      chainId: 8453,
    },
    sepolia: {
      address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const,
      decimals: 6,
      network: 'eip155:84532' as const,
      chainId: 84532,
    },
  },
  solana: {
    mainnet: {
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      decimals: 6,
      network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const,
    },
    devnet: {
      mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      decimals: 6,
      network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' as const,
    },
  },
  tempo: {
    mainnet: {
      address: '0x20C000000000000000000000b9537d11c60E8b50' as const,
      decimals: 6,
      chainId: 4217,
    },
    testnet: {
      address: '0x20c0000000000000000000000000000000000000' as const,
      decimals: 6,
      chainId: 42431,
    },
  },
} as const;

export type EvmConfig = {
  address: `0x${string}`;
  decimals: number;
  rpcUrl: string;
  network: string;
  chainId: number;
};

export type SvmConfig = {
  mint: string;
  decimals: number;
  rpcUrl: string;
  network: string;
};

export function evmConfig(chain: 'base' | 'tempo', network: Network = 'mainnet'): EvmConfig {
  if (chain === 'base') {
    if (network === 'mainnet') {
      return { ...USDC.base.mainnet, rpcUrl: rpcUrl('BASE_RPC_URL', DEFAULT_RPC.base_mainnet) };
    }
    return { ...USDC.base.sepolia, rpcUrl: rpcUrl('BASE_SEPOLIA_RPC_URL', DEFAULT_RPC.base_sepolia) };
  }
  if (network === 'mainnet') {
    const src = USDC.tempo.mainnet;
    return {
      address: src.address,
      decimals: src.decimals,
      rpcUrl: rpcUrl('TEMPO_RPC_URL', DEFAULT_RPC.tempo_mainnet),
      network: `eip155:${src.chainId}`,
      chainId: src.chainId,
    };
  }
  const src = USDC.tempo.testnet;
  return {
    address: src.address,
    decimals: src.decimals,
    rpcUrl: rpcUrl('TEMPO_TESTNET_RPC_URL', DEFAULT_RPC.tempo_testnet),
    network: `eip155:${src.chainId}`,
    chainId: src.chainId,
  };
}

export function svmConfig(network: Network = 'mainnet'): SvmConfig {
  if (network === 'mainnet') {
    return { ...USDC.solana.mainnet, rpcUrl: rpcUrl('SOLANA_RPC_URL', DEFAULT_RPC.solana_mainnet) };
  }
  return { ...USDC.solana.devnet, rpcUrl: rpcUrl('SOLANA_DEVNET_RPC_URL', DEFAULT_RPC.solana_devnet) };
}

const KNOWN_USDC_BY_CHAIN: Record<Chain, ReadonlyArray<string>> = {
  base: [USDC.base.mainnet.address, USDC.base.sepolia.address],
  solana: [USDC.solana.mainnet.mint, USDC.solana.devnet.mint],
  tempo: [USDC.tempo.mainnet.address, USDC.tempo.testnet.address],
};

export function isKnownUSDC(asset: string | null | undefined, chain: Chain): boolean {
  if (!asset) return false;
  const candidates = KNOWN_USDC_BY_CHAIN[chain];
  if (chain === 'solana') {
    return candidates.includes(asset);
  }
  const lc = asset.toLowerCase();
  return candidates.some((c) => c.toLowerCase() === lc);
}
