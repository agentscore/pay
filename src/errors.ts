export type ErrorCode =
  | 'no_wallet'
  | 'wallet_exists'
  | 'wrong_passphrase'
  | 'passphrase_too_short'
  | 'passphrase_mismatch'
  | 'no_funded_rail'
  | 'multi_rail_candidates'
  | 'unsupported_rail'
  | 'insufficient_balance'
  | 'max_spend_exceeded'
  | 'limit_exceeded'
  | 'network_error'
  | 'rpc_error'
  | 'unknown_chain'
  | 'invalid_key'
  | 'invalid_input'
  | 'user_cancelled'
  | 'config_error'
  | 'merchant_error'
  | 'session_timeout'
  | 'unknown';

export const EXIT_CODES = {
  SUCCESS: 0,
  USER_ERROR: 1,
  NETWORK_ERROR: 2,
  INSUFFICIENT_FUNDS: 3,
  PAYMENT_REJECTED: 4,
  MULTI_RAIL_AMBIGUITY: 5,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export function exitCodeForError(code: ErrorCode): ExitCode {
  switch (code) {
    case 'network_error':
    case 'rpc_error':
    case 'merchant_error':
      return EXIT_CODES.NETWORK_ERROR;
    case 'insufficient_balance':
    case 'no_funded_rail':
      return EXIT_CODES.INSUFFICIENT_FUNDS;
    case 'max_spend_exceeded':
    case 'limit_exceeded':
      return EXIT_CODES.PAYMENT_REJECTED;
    case 'multi_rail_candidates':
      return EXIT_CODES.MULTI_RAIL_AMBIGUITY;
    default:
      return EXIT_CODES.USER_ERROR;
  }
}

export interface NextSteps {
  action: string;
  suggestion?: string;
}

export class CliError extends Error {
  readonly code: ErrorCode;
  readonly nextSteps?: NextSteps;
  readonly extra: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, options: { nextSteps?: NextSteps; extra?: Record<string, unknown> } = {}) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.nextSteps = options.nextSteps;
    this.extra = options.extra ?? {};
  }
}
