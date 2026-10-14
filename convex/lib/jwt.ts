/**
 * ES256 JWTs for MeetCal-issued tokens (`convex/apiTokens.ts`), signed with
 * Web Crypto. The signing key is a P-256 private JWK with a `kid`, kept in the
 * `MEETCAL_TOKEN_SIGNING_KEY` environment variable
 * (`scripts/generate-token-signing-key.ts` makes one); Convex verifies the
 * tokens against the public half, served at `/.well-known/jwks.json`.
 */

export type SigningJwk = JsonWebKey & { kid: string; kty: 'EC'; crv: 'P-256'; d: string; x: string; y: string };
export type PublicJwk = { kty: 'EC'; crv: 'P-256'; x: string; y: string; kid: string; alg: 'ES256'; use: 'sig' };

/** The signing key from its environment variable's text, or null when it is unset or not a P-256 private JWK. */
export function parseSigningJwk(raw: string | undefined): SigningJwk | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const jwk = value as Record<string, unknown>;
  const text = (key: string) => typeof jwk[key] === 'string' && (jwk[key] as string).length > 0;
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !text('d') || !text('x') || !text('y') || !text('kid')) return null;
  return jwk as unknown as SigningJwk;
}

/** The key's public half, as a JWKS entry. */
export function publicJwk(key: SigningJwk): PublicJwk {
  return { kty: 'EC', crv: 'P-256', x: key.x, y: key.y, kid: key.kid, alg: 'ES256', use: 'sig' };
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const encodeJson = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));

/** A compact JWS of `claims`, signed with `key` (ES256: the raw r‖s signature Web Crypto makes). */
export async function signJwt(key: SigningJwk, claims: Record<string, unknown>): Promise<string> {
  const { kty, crv, x, y, d } = key;
  const privateKey = await crypto.subtle.importKey('jwk', { kty, crv, x, y, d }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signingInput = `${encodeJson({ alg: 'ES256', typ: 'JWT', kid: key.kid })}.${encodeJson(claims)}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}
