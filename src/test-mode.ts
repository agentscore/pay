/**
 * Test-mode helpers for AgentScore reserved test addresses.
 *
 * AgentScore's `/v1/assess` endpoint recognizes a small set of EVM addresses
 * (`0x0000…0001` through `0x0000…0007`) as test fixtures with deterministic policy
 * outcomes — KYC verified, sanctions clear, age gates passing, etc. Using them in
 * dev/test means no real KYC credit burn and predictable behavior.
 *
 * This module just recognizes them. The flag is purely informational — pay still
 * sends real payment headers, the difference is that the merchant's gate (when also
 * pointed at AgentScore test mode) treats the identity as a fixture rather than a
 * production wallet.
 */

const TEST_ADDRESSES: ReadonlySet<string> = new Set([
  '0x0000000000000000000000000000000000000001',
  '0x0000000000000000000000000000000000000002',
  '0x0000000000000000000000000000000000000003',
  '0x0000000000000000000000000000000000000004',
  '0x0000000000000000000000000000000000000005',
  '0x0000000000000000000000000000000000000006',
  '0x0000000000000000000000000000000000000007',
]);

/**
 * Returns true when the given EVM address is one of the AgentScore reserved test
 * fixtures. Lowercases for comparison so accidentally mixed-case input still matches.
 */
export function isAgentScoreTestAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  return TEST_ADDRESSES.has(address.toLowerCase());
}

/**
 * The full list of reserved test addresses, exposed for documentation, completion,
 * and downstream test fixtures.
 */
export const AGENTSCORE_TEST_ADDRESSES: readonly string[] = [...TEST_ADDRESSES];
