import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  signature as toSignature,
  address as solAddress,
} from '@solana/kit';
import {
  fetchToken,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { svmConfig, type Network } from '../constants';
import { CliError, wrapRpcError } from '../errors';

export function generateKey(): Buffer {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
}

export async function keyToAddress(key: Buffer): Promise<string> {
  const signer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(key));
  return signer.address;
}

export async function createSigner(key: Buffer) {
  return createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(key));
}

export async function balance(ownerBase58: string, network: Network = 'mainnet'): Promise<bigint> {
  const cfg = svmConfig(network);
  const rpc = createSolanaRpc(cfg.rpcUrl);
  const owner = solAddress(ownerBase58);
  const mint = solAddress(cfg.mint);
  try {
    const accounts = await rpc
      .getTokenAccountsByOwner(owner, { mint }, { encoding: 'base64' })
      .send();
    if (!accounts.value.length) return 0n;
    const ata = accounts.value[0].pubkey;
    const token = await fetchToken(rpc, ata);
    return token.data.amount;
  } catch (err: unknown) {
    throw wrapRpcError('solana', network, err);
  }
}

export function qrUri(addr: string, amountUsd?: number, network: Network = 'mainnet'): string {
  const cfg = svmConfig(network);
  const base = `solana:${addr}`;
  if (!amountUsd || amountUsd <= 0) return base;
  const params = new URLSearchParams({
    amount: amountUsd.toFixed(cfg.decimals),
    'spl-token': cfg.mint,
  });
  return `${base}?${params.toString()}`;
}

export function formatBalance(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const frac = raw % 1_000_000n;
  return `${whole.toString()}.${frac.toString().padStart(6, '0')}`;
}

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function nativeBalance(ownerBase58: string, network: Network = 'mainnet'): Promise<bigint> {
  const cfg = svmConfig(network);
  const rpc = createSolanaRpc(cfg.rpcUrl);
  try {
    const { value } = await rpc.getBalance(solAddress(ownerBase58)).send();
    return BigInt(value);
  } catch (err: unknown) {
    throw wrapRpcError('solana', network, err);
  }
}

export function formatNative(raw: bigint): string {
  // SOL has 9 decimals (lamports). Show 4 fractional digits — enough for
  // typical fee-balance reads.
  const whole = raw / 10n ** 9n;
  const frac = raw % 10n ** 9n;
  const fracPadded = frac.toString().padStart(9, '0').slice(0, 4);
  return `${whole.toString()}.${fracPadded}`;
}

export const NATIVE_SYMBOL = 'SOL';

async function pollConfirm(rpc: ReturnType<typeof createSolanaRpc>, sig: string, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { value } = await rpc.getSignatureStatuses([toSignature(sig)]).send();
    const status = value[0];
    if (status) {
      if (status.err) {
        throw new CliError('rpc_error', `Solana transaction failed: ${JSON.stringify(status.err)}`, { extra: { signature: sig } });
      }
      if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new CliError('session_timeout', 'Solana transaction confirmation timed out (30s).', { extra: { signature: sig } });
}

export async function transfer(input: {
  key: Buffer;
  to: string;
  amountUsd: number;
  network?: Network;
}): Promise<{ tx_hash: string; from: string; to: string; amount_usdc: string }> {
  const network = input.network ?? 'mainnet';
  if (!SOLANA_ADDRESS_RE.test(input.to)) {
    throw new CliError('invalid_wallet_address', `--to must be a base58 Solana address. Got: ${input.to}`);
  }
  const cfg = svmConfig(network);
  const rpc = createSolanaRpc(cfg.rpcUrl);
  const signer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(input.key));
  const mint = solAddress(cfg.mint);
  const recipient = solAddress(input.to);
  const amount = BigInt(Math.round(input.amountUsd * 10 ** cfg.decimals));

  try {
    const [sourceAta] = await findAssociatedTokenPda({
      owner: signer.address,
      mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const [destAta] = await findAssociatedTokenPda({
      owner: recipient,
      mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    // Create-if-missing the recipient's ATA, then transferChecked. Idempotent
    // variant of CreateAssociatedToken is a no-op when the ATA already exists.
    const createAtaIx = getCreateAssociatedTokenIdempotentInstruction({
      payer: signer,
      ata: destAta,
      owner: recipient,
      mint,
    });
    const transferIx = getTransferCheckedInstruction({
      source: sourceAta,
      mint,
      destination: destAta,
      authority: signer,
      amount,
      decimals: cfg.decimals,
    });

    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(signer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstructions([createAtaIx, transferIx], m),
    );
    const signed = await signTransactionMessageWithSigners(txMessage);
    const encoded = getBase64EncodedWireTransaction(signed);
    const sig = await rpc.sendTransaction(encoded, { encoding: 'base64', skipPreflight: false }).send();
    await pollConfirm(rpc, sig);
    const signatureStr = getSignatureFromTransaction(signed);
    return {
      tx_hash: signatureStr,
      from: signer.address,
      to: input.to,
      amount_usdc: formatBalance(amount),
    };
  } catch (err: unknown) {
    if (err instanceof CliError) throw err;
    throw wrapRpcError('solana', network, err);
  }
}
