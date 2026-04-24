import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/kit';
import { createPublicClient, erc20Abi, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { describe, expect, it } from 'vitest';
import * as solanaChain from '../../src/chains/solana';
import { USDC } from '../../src/constants';

const EVM_KEY = process.env.BASE_SEPOLIA_PRIVATE_KEY as `0x${string}` | undefined;
const SVM_KEY = process.env.SOLANA_DEVNET_PRIVATE_KEY;

describe.skipIf(!EVM_KEY)('integration: Base Sepolia balance', () => {
  it('reads USDC balance for the funded account', async () => {
    const account = privateKeyToAccount(EVM_KEY as `0x${string}`);
    const client = createPublicClient({
      chain: baseSepolia,
      transport: http(USDC.base.sepolia.rpcUrl),
    });
    const raw = await client.readContract({
      address: USDC.base.sepolia.address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    });
    expect(typeof raw).toBe('bigint');
  });
});

describe.skipIf(!SVM_KEY)('integration: Solana Devnet balance', () => {
  it('derives address from the devnet seed', async () => {
    const bytes = Buffer.from(SVM_KEY as string, 'base64');
    expect(bytes.length).toBe(32);
    const signer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(bytes));
    expect(signer.address).toBeTruthy();
    // Balance read can be added once we wire Solana network parameter through
    // the chain helpers; for now the integration stub confirms the key path
    // and keeps the test suite ready for devnet RPC polling.
    const _addr = signer.address;
    void solanaChain;
  });
});
