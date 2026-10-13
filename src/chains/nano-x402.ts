import { CliError } from '../errors';
import { normalizeAddress, send, type NanoRpc } from './nano';
import type { PaymentPayloadResult, PaymentRequirements, SchemeNetworkClient } from '@x402/core/types';

const NANO_DECIMALS = 30;

/**
 * x402 `exact` on Nano. Nano has no transfer authorization to hand a facilitator,
 * so the client publishes the state send block itself and the payload carries
 * the block hash for the merchant to confirm on its own node.
 */
export class ExactNanoScheme implements SchemeNetworkClient {
  readonly scheme = 'exact';

  constructor(
    private readonly opts: {
      key: Buffer;
      rpc?: NanoRpc;
      /**
       * Blocks already published in this invocation, keyed by payTo and amount. A retried
       * request re-presents the same block instead of paying a second time.
       */
      published?: Map<string, string>;
      /** Receives errors before x402 wraps them, so the caller can keep the structured code. */
      onError?: (err: unknown) => void;
    },
  ) {}

  async createPaymentPayload(x402Version: number, requirements: PaymentRequirements): Promise<PaymentPayloadResult> {
    try {
      const declared = requirements.extra?.decimals;
      if (declared !== undefined && declared !== NANO_DECIMALS) {
        throw new CliError(
          'merchant_spec_violation',
          `Merchant 402 declared ${String(declared)} decimals for XNO; Nano raw has ${NANO_DECIMALS}. Refusing to pay.`,
          { extra: { chain: 'nano', decimals: declared } },
        );
      }
      if (!/^\d+$/.test(requirements.amount ?? '')) {
        throw new CliError('merchant_spec_violation', `Merchant 402 amount is not integer raw: ${requirements.amount}`, {
          extra: { chain: 'nano', amount: requirements.amount },
        });
      }
      const payTo = normalizeAddress(requirements.payTo);
      const key = `${payTo}:${requirements.amount}`;
      let blockHash = this.opts.published?.get(key);
      if (!blockHash) {
        const sent = await send({ key: this.opts.key, to: payTo, amountRaw: BigInt(requirements.amount), rpc: this.opts.rpc });
        blockHash = sent.hash;
        this.opts.published?.set(key, blockHash);
      }
      return { x402Version, payload: { blockHash } };
    } catch (err: unknown) {
      this.opts.onError?.(err);
      throw err;
    }
  }
}
