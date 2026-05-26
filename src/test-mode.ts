/**
 * Test-mode helpers for AgentScore reserved test addresses.
 *
 * Re-exports the canonical recognizer + address list from `@agent-score/sdk`,
 * the home shared by pay, mcp, commerce, and the SDKs, so the reserved-address
 * list stays in sync with the AgentScore API spec. Internal use only; consumers
 * import these directly from `@agent-score/sdk`.
 */

export { AGENTSCORE_TEST_ADDRESSES, isAgentScoreTestAddress } from '@agent-score/sdk';
