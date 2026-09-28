# Architecture

meetcal.app is a client-side rendered Leptos app. Trunk compiles it to WebAssembly; Vercel serves
the static output and a small HTML shell per route. There is no server of its own: data comes from
Convex, sign-in from Clerk, and the subscription check from RevenueCat, all called from the
browser.

## Data: Convex over HTTP

Every read goes through `src/utils/api.rs`, which posts to Convex's HTTP API:

```text
POST https://disciplined-hare-790.convex.cloud/api/query
{ "path": "reference:records", "args": {}, "format": "json" }
```

- `queries` lists every Convex function the site reads, each with the Rust API route it replaced
  (the site read `api.meetcal.app` before Convex). Pages call `query(queries::RECORDS)` or
  `query_with(queries::WSO_RECORDS, &args)`; they never build a URL.
- A query's answer carries its body one of two ways, recorded on the `Query`:
  - `Body::JsonText`: `{ json }` or `{ etag, json }`, the body as JSON text. Most list answers
    (records, rankings, rosters, results) come this way because Convex serves text faster than the
    same rows as values. The site sends no `ifNoneMatch`, so `json` is always present.
  - `Body::Value`: the answer is the body (`results:search`, `reference:clubAthletes`,
    `reference:clubMeetStats`). Convex writes its numbers as floats (`2.0`); `api.rs` turns whole
    numbers back into integers before parsing.
- A function that ran and failed answers `{ status: "error", errorMessage, errorData }`, over HTTP
  200 or 560. Our functions throw `{ status, error }` as `errorData`; the site shows `error`.
- 429 and 503 are retried twice, honoring `Retry-After` (1 to 10 seconds). Every call is a read,
  so a retry is safe.
- `MEETCAL_CONVEX_URL` (compile time) points a build at another deployment. Production's CSP allows
  only the production deployment, so a preview built against dev is blocked on Vercel.

The queries themselves are in `../convex/` (`reference.ts`, `meets.ts`, `results.ts`). Many are
served from materialized views; `../docs/backend.md` explains when a view needs rebuilding after a
deploy.

## Sign-in and the subscription gate

`src/auth.rs` loads Clerk and RevenueCat's web SDKs through `src/auth_bridge.js` (loaded from
jsDelivr and unpkg, which the CSP allows). The publishable keys are compiled in from
`CLERK_PUBLISHABLE_KEY` and `REVENUECAT_PUBLIC_API_KEY`.

`SubscriptionGate` (`src/components/subscription_gate.rs`) wraps each competition data route in
`src/main.rs`: signed out, it mounts Clerk's sign-in; signed in, it asks RevenueCat whether the
Clerk user has an active entitlement, and shows the page or the subscription handoff. Purchases
happen in the mobile app only (`/subscription` sends users there).

The gate is a soft, client-side check, like the app's paywall. The data it guards is public in
Convex.

## Routes and metadata

Each route needs a document that search engines and link previews can read before the Wasm loads:

- `scripts/generate-bootstrap.sh` runs after every Trunk build. It writes `app-bootstrap.js` (which
  loads the Wasm) and renders one shell per route into `dist/seo/<name>.html`, each with its own
  title, description, canonical URL and robots directive. Competition data pages are
  `noindex, nofollow`.
- `vercel.json` rewrites each route to its shell (`/records` to `/seo/records.html`).
- Once the app runs, `RouteMetadata` (`src/components/seo.rs`) keeps the title and meta tags in
  step as the user navigates. Data pages take theirs from `DATA_PAGES` in
  `src/pages/comp_data/catalog.rs`.

### Adding a page

For a new competition data page, all of these change together:

1. `src/pages/comp_data/<page>.rs` (and `mod.rs`).
2. `src/main.rs`: the route, inside `SubscriptionGate`.
3. `src/pages/comp_data/catalog.rs`: a `DATA_PAGES` entry. This adds it to the header menu, the
   data home and the route metadata.
4. `scripts/generate-bootstrap.sh`: a line in the competition pages list.
5. `vercel.json`: the rewrite to its shell.
6. `tests/e2e/support/routes.ts`: `protectedDataRoutes`, so the route, gate and metadata tests
   cover it; and a test for the page itself in `tests/e2e/competition.spec.ts`.

A public page follows the same steps without the gate, with its own entry in
`metadata_for_path` and `render_page` instead of the catalog, and in `publicRoutes`.

## Deploying

Vercel's project `meetcal-web` builds this folder (project root `web/`) with
`scripts/vercel-build.sh`: it installs Rust and Trunk, writes `public/posthog-env.js` from
`POSTHOG_API_KEY`, and runs `trunk build --release` into `dist/`. Production deploys from
`master`; every pull request gets a preview. `vercel.json` also sets the security headers,
including the CSP, for every response.

Analytics: `public/posthog-init.js` loads PostHog with the key the build wrote.
