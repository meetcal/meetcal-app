/**
 * Prints a new signing key for MeetCal-issued tokens (`convex/apiTokens.ts`):
 * a P-256 private JWK with a `kid`, as one line of JSON. Pipe it straight into
 * the deployment so it never lands in a file or the terminal:
 *
 *   npx convex env set MEETCAL_TOKEN_SIGNING_KEY "$(mise exec -- bun scripts/generate-token-signing-key.ts)"
 *
 * Replacing the key ends every token issued with the old one: the CLI and
 * Siri sign in again.
 */
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const { kty, crv, x, y, d } = jwk;
console.log(JSON.stringify({ kty, crv, x, y, d, kid: crypto.randomUUID() }));
