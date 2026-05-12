/**
 * Client for the AgentScore Crypto Onramp endpoint (POST /v1/onramp/sessions).
 *
 * Auth model matches /v1/sessions/refresh: X-Client-Id header + operator_token
 * in body. No merchant API key needed; the agent's stored passport credential
 * resolves to their account.
 *
 * The hosted_url returned points at Stripe's hosted onramp (crypto.link.com).
 * The CLI never auto-opens a browser — emit the URL on stderr and let the
 * user click it from their terminal.
 */

import { loadPassport } from './passport/storage';

const ONRAMP_BASE_URL = process.env.AGENTSCORE_BASE_URL ?? 'https://api.agentscore.sh';
const PUBLIC_CLIENT_ID = 'agentscore_pay_pubclient_v1';

export type OnrampChain = 'base' | 'solana';

export interface CreateOnrampSessionInput {
  walletAddress: string;
  chain: OnrampChain;
  /** Fiat amount the user pays. Mutually exclusive with destinationAmount. */
  amountUsd?: number;
  /** USDC amount the user receives. Mutually exclusive with amountUsd. */
  destinationAmount?: number;
  sourceCurrency?: 'usd' | 'eur';
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export interface CreateOnrampQuoteInput {
  chain: OnrampChain;
  amountUsd?: number;
  destinationAmount?: number;
  sourceCurrency?: 'usd' | 'eur';
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export interface OnrampQuoteResponse {
  chain: OnrampChain;
  source_amount: string;
  source_currency: string;
  destination_amount: string;
  destination_currency: 'usdc';
  destination_network: string;
  source_total_amount: string;
  network_fee_monetary: string;
  transaction_fee_monetary: string;
  rate_fetched_at: number;
}

export interface OnrampSessionResponse {
  session_id: string;
  hosted_url: string;
  wallet_address: string;
  chain: OnrampChain;
  network: string;
  destination_currency: 'usdc';
  locked: boolean;
}

export interface OnrampErrorAgentInstructions {
  action: string;
  steps?: string[];
  user_message?: string;
}

export class OnrampApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly agentInstructions?: OnrampErrorAgentInstructions,
    public readonly stripeRequestId?: string,
  ) {
    super(message);
    this.name = 'OnrampApiError';
  }
}

export async function createOnrampSession(input: CreateOnrampSessionInput): Promise<OnrampSessionResponse> {
  const passport = await loadPassport();
  if (!passport) {
    throw new OnrampApiError(
      'passport_login_required',
      'No passport credential found. Run `agentscore-pay passport login` to mint one.',
      401,
      { action: 'passport_login', steps: ['agentscore-pay passport login'] },
    );
  }

  const baseUrl = (input.baseUrl ?? ONRAMP_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = input.fetch ?? globalThis.fetch;

  const body: Record<string, unknown> = {
    operator_token: passport.operator_token,
    wallet_address: input.walletAddress,
    chain: input.chain,
  };
  if (input.amountUsd !== undefined) { body.amount_usd = input.amountUsd; }
  if (input.destinationAmount !== undefined) { body.destination_amount = input.destinationAmount; }
  if (input.sourceCurrency !== undefined) { body.source_currency = input.sourceCurrency; }

  const response = await fetchImpl(`${baseUrl}/v1/onramp/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': '@agent-score/pay',
      'X-Client-Id': PUBLIC_CLIENT_ID,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    interface ParsedError {
      error?: {
        code?: string;
        message?: string;
        agent_instructions?: OnrampErrorAgentInstructions;
        stripe_request_id?: string;
      };
    }
    let parsed: ParsedError | null = null;
    try { parsed = text ? (JSON.parse(text) as ParsedError) : null; } catch { parsed = null; }
    throw new OnrampApiError(
      parsed?.error?.code ?? 'http_error',
      parsed?.error?.message ?? `HTTP ${response.status}`,
      response.status,
      parsed?.error?.agent_instructions,
      parsed?.error?.stripe_request_id,
    );
  }

  return JSON.parse(text) as OnrampSessionResponse;
}

/**
 * Fetch a Stripe Crypto Onramp price preview without committing to a session.
 * No passport credential needed — quotes are public pricing information.
 */
export async function getOnrampQuote(input: CreateOnrampQuoteInput): Promise<OnrampQuoteResponse> {
  const baseUrl = (input.baseUrl ?? ONRAMP_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = input.fetch ?? globalThis.fetch;

  const body: Record<string, unknown> = { chain: input.chain };
  if (input.amountUsd !== undefined) { body.amount_usd = input.amountUsd; }
  if (input.destinationAmount !== undefined) { body.destination_amount = input.destinationAmount; }
  if (input.sourceCurrency !== undefined) { body.source_currency = input.sourceCurrency; }

  const response = await fetchImpl(`${baseUrl}/v1/onramp/quotes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': '@agent-score/pay',
      'X-Client-Id': PUBLIC_CLIENT_ID,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    interface ParsedError {
      error?: {
        code?: string;
        message?: string;
        agent_instructions?: OnrampErrorAgentInstructions;
        stripe_request_id?: string;
      };
    }
    let parsed: ParsedError | null = null;
    try { parsed = text ? (JSON.parse(text) as ParsedError) : null; } catch { parsed = null; }
    throw new OnrampApiError(
      parsed?.error?.code ?? 'http_error',
      parsed?.error?.message ?? `HTTP ${response.status}`,
      response.status,
      parsed?.error?.agent_instructions,
      parsed?.error?.stripe_request_id,
    );
  }

  return JSON.parse(text) as OnrampQuoteResponse;
}
