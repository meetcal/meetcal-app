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
    // MeetCal-issued tokens (`convex/apiTokens.ts`) for the CLI and Siri,
    // signed by this deployment and checked against its own JWKS. The
    // audience is `API_TOKEN_AUDIENCE`.
    {
      type: 'customJwt',
      issuer: process.env.CONVEX_SITE_URL!,
      jwks: `${process.env.CONVEX_SITE_URL}/.well-known/jwks.json`,
      algorithm: 'ES256',
      applicationID: 'meetcal',
    },
  ],
} satisfies AuthConfig;
