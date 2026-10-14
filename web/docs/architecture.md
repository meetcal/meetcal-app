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
  - `Body::Value`: the answer is the body (`results:search`, `reference:clubMeetStats`). Convex
    writes its numbers as floats (`2.0`); `api.rs` turns whole numbers back into integers before
    parsing.
- `reference:clubAthletes` is paged: `query_all_pages` sends `cursor: null`, then each returned
  `cursor`, and concatenates each page's `{ json, cursor, isDone }` rows until `isDone`, failing
  after `MAX_PAGES`. Rows are not ordered or unique across pages.
- A function that ran and failed answers `{ status: "error", errorMessage, errorData }`, over HTTP
  200 or 560. Our functions throw `{ status, error }` as `errorData`; the site shows `error`.
- 429 and 503 are retried twice, honoring `Retry-After` (1 to 10 seconds). Every query is a read,
  so a retry is safe. The site's only mutations, `deviceLogin:approve`, `deviceLogin:deny` and
  `apiTokens:revokeAllCli` (`POST /api/mutation`, from `/link`), are never retried by themselves:
  the user taps Try again.
- The premium functions (`SUBSCRIPTION_FUNCTIONS` in `api.rs`, Convex's `PREMIUM_FUNCTIONS`) take
  the access pass as their `pass` argument; `api.rs` adds it to their arguments. A search
  (`results:search`) takes it only with `startDate` and `endDate`: name suggestions are public.
  Every other query goes out without it. No query carries the user's session token except
  `accessPass:pass` and `deviceLogin:describe` (one user's own CLI sign-in, below): a query that reads its caller is cached per user, while every subscriber sends
  the same pass, so premium answers stay in Convex's shared query cache.
- The pass comes from `accessPass:pass` (`POST /api/query` with `Authorization: Bearer <Clerk
  session token>`, Clerk's default token, as the app sends), which answers `{ pass, rotatesAt }`.
  `api.rs` fetches it before the first premium read, only for a signed-in user, and holds it in
  memory (never stored) until `rotatesAt`, or at least five minutes so a fast device clock cannot
  make every read fetch it; concurrent reads share one fetch. Convex accepts a pass until the
  rotation after the one that replaced it, so a slightly stale pass still works. Signing in, out
  or as another user forgets it.
- When `accessPass:pass` answers 403 (Convex has no active entitlement for the user), `api.rs`
  calls the `entitlements:refresh` action (`POST /api/action`, same token), which asks RevenueCat
  and records the entitlement, and, if it answers `{ active: true }`, asks for the pass once more.
  This is how Convex learns of a subscriber its RevenueCat webhook never reported (a lifetime
  purchase never renews).
- Without a pass (signed out, not subscribed, offline, Clerk slow to hand over a token) a premium
  read goes out without one, and a failed fetch is not tried again for a minute. If Convex refuses
  a premium read for its pass (a function error with status 401, "access pass required", or 403,
  "access pass expired"), `api.rs` drops the held pass, fetches a fresh one, and sends the read
  once more with it.
- `MEETCAL_CONVEX_URL` (compile time) points a build at another deployment. Production's CSP allows
  only the production deployment, so a preview built against dev is blocked on Vercel.

The queries themselves are in `../convex/` (`reference.ts`, `meets.ts`, `results.ts`). Many are
served from materialized views; `../docs/backend.md` explains when a view needs rebuilding after a
deploy.

## Sign-in and the subscription gate

`src/auth.rs` loads Clerk and RevenueCat's web SDKs through `src/auth_bridge.js`, from pinned
versions on jsDelivr and unpkg. Each file loads with a Subresource Integrity hash, and the CSP
allows only those versions' directories. The chunks Clerk loads later from those directories
carry no integrity hash (Clerk's chunk loader doesn't set one), so only the CSP pin covers them.
Upgrading an SDK means changing its version and hash in `auth_bridge.js` and its path in
`vercel.json` (`tests/config/vercel.test.mjs` checks they agree). The publishable keys are
compiled in from
`CLERK_PUBLISHABLE_KEY` and `REVENUECAT_PUBLIC_API_KEY`.

`SubscriptionGate` (`src/components/subscription_gate.rs`) wraps each competition data route in
`src/main.rs`: signed out, it mounts Clerk's sign-in, which returns to the same page; signed in,
it asks RevenueCat whether the Clerk user has the `Subscriptions` entitlement (the one the app
checks, `src/lib/premium-intent.ts`), and shows the page or the subscription handoff. Purchases
happen in the mobile app only (`/subscription` sends users there).

Every route's gate reads one shared answer (`provide_access`, next to `provide_auth`), so moving
between data pages neither checks again nor rebuilds the page. It is checked again when the
Clerk user changes, when a page opens after a refusal or an error, and in the background when a
page opens more than ten minutes after the last grant.

The gate is a client-side check, like the app's paywall. Convex is moving to enforce the
subscription itself through the access pass (above): for now it only logs a premium read without a
current pass, answering everyone; later it will refuse it. Until then the data the gate guards is
still public in Convex.

## Approving a CLI sign-in: `/link`

`meetcal login` (the CLI in `../cli/`) prints a code such as `WXYZ-BCDF`, a link to
`https://meetcal.app/link?code=WXYZ-BCDF` and a QR code of it, and waits. `src/pages/link.rs`
is the page the link opens. It needs a signed-in user but no subscription, so its route in
`src/main.rs` sits outside `SubscriptionGate`, and it is in no navigation menu or sitemap
(`noindex, nofollow`).

- The URL holds the code. Signed out, the page mounts the same Clerk sign-in as the gate, which
  returns to the current URL, `/link?code=…`, query included. Without a code (or with only part
  of one) it asks for it: the field keeps letters only (codes have no digits, and the server drops
  them), uppercases them, caps them at eight and adds the dash (`ABCD-EFGH`); Continue moves to
  `/link?code=ABCD-EFGH`.
- With a whole code it asks `deviceLogin:describe` (`POST /api/query`), which answers
  `{ deviceName, createdAt, expiresAt }` or `null`, and shows the device, the code and how long ago
  it asked, with a warning to approve only a `meetcal login` the user just ran. The device name is
  the requester's own claim, so it is shown in quotes as "the name the device gave itself": a
  requester cannot pass for the MeetCal app. Approve and Deny call `deviceLogin:approve` and
  `deviceLogin:deny` (`POST /api/mutation`), which answer `{ ok: true }`. Approve answers a
  function error with status 404 for a code no login is waiting on. Deny also turns down a login
  this user approved whose token the CLI has not collected yet (second thoughts in another tab),
  and answers 404 when nothing is left to turn down (expired, or the CLI already has its token):
  the page then shows the code as expired or used, never "denied", since the CLI may be signed in. All three carry `Authorization: Bearer <Clerk session token>`, and a 401 asks the user to try
  again, which fetches a fresh token. The calls are in `api.rs` (`describe_device_login`,
  `approve_device_login`, `deny_device_login`, `revoke_all_cli_logins`).
- States: checking sign-in, sign-in, code entry, looking up, the request (Approve / Deny),
  approved ("Done — you can return to your terminal."), denied, expired or used (a `null`
  describe or a 404 approve: run `meetcal login` again; a 404 deny: it could not be denied), and
  an error with Try again, which repeats the call that failed.
- Recovery: below the card, whenever the user is signed in (done and denied included), "Sign out
  all CLI logins" asks "Sign out every computer signed in with meetcal login?", then calls the
  mutation `apiTokens:revokeAllCli` (`POST /api/mutation`, args `{}`, the same bearer token), which
  answers `{ ended }`, and shows "Signed out N CLI logins." A failure shows the error with Try
  again; like the other mutations, it is never sent again without a tap.

## Routes and metadata

Each route needs a document that search engines and link previews can read before the Wasm loads:

- `scripts/generate-bootstrap.sh` runs after every Trunk build. It writes `app-bootstrap.js` (which
  loads the Wasm, then removes `index.html`'s `#app-loading` shell, or turns it into an error with
  a retry when the load fails) and renders one shell per route into `dist/seo/<name>.html`, each with its own
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
`metadata_for_path` and `render_page` instead of the catalog, and in `publicRoutes`. A page that
needs a signed-in user but no subscription (`/link`) goes in `signedInRoutes` instead.

## Deploying

Vercel's project `meetcal-web` builds this folder (project root `web/`) with
`scripts/vercel-build.sh`: it installs Rust and Trunk, writes `public/posthog-env.js` from
`POSTHOG_API_KEY`, and runs `trunk build --release` into `dist/`. Production deploys from
`master`; every pull request gets a preview. `vercel.json` also sets the security headers,
including the CSP, for every response.

Analytics: `public/posthog-init.js` loads PostHog with the key the build wrote.
