import type { AuthConfig } from 'convex/server';

/**
 * The app sends Clerk's default session token (`getToken()`, no template),
 * the same one the Rust API verifies. A native session token carries no `aud`,
 * so this is a `customJwt` provider checked on issuer and signature only, like
 * the Rust verifier without an audience configured.
 */
export default {
  providers: [
    {
      type: 'customJwt',
      issuer: process.env.CLERK_ISSUER!,
      jwks: process.env.CLERK_JWKS_URL!,
      algorithm: 'RS256',
    },
  ],
} satisfies AuthConfig;
