/**
 * Test-mode helpers for AgentScore reserved test addresses.
 *
 * Re-exports the canonical recognizer + address list from `@agent-score/sdk`.
 * Pay keeps the `@agent-score/pay/test-mode` import path stable for downstream
 * consumers; the underlying constant lives in the SDK so it stays in sync with
 * the AgentScore API spec across pay, mcp, commerce, and the SDKs themselves.
 */

export { AGENTSCORE_TEST_ADDRESSES, isAgentScoreTestAddress } from '@agent-score/sdk';
