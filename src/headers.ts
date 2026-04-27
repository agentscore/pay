/**
 * Merge default headers with user-supplied headers, treating header names as
 * case-insensitive (RFC 7230) so the user's `-H 'content-type: ...'` overrides
 * the CLI's default `Content-Type` instead of producing a duplicate.
 *
 * Without this dedupe step, `Object.assign({Content-Type: 'application/json'}, {'content-type': 'application/json'})`
 * keeps BOTH keys and `fetch` sends them as a comma-joined value (`application/json, application/json`),
 * which strict body-parsers (Express's, etc.) reject — silently breaking POSTs against any merchant
 * whose server doesn't tolerate the duplicate.
 */
export function mergeHeaders(
  defaults: Record<string, string>,
  user: Record<string, string> = {},
): Record<string, string> {
  const userKeysLower = new Set(Object.keys(user).map((k) => k.toLowerCase()));
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(defaults)) {
    if (!userKeysLower.has(k.toLowerCase())) result[k] = v;
  }
  for (const [k, v] of Object.entries(user)) {
    result[k] = v;
  }
  return result;
}
