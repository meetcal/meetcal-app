# MeetCal Web

meetcal.app: the marketing pages and the subscription competition data pages, written in Rust with Leptos (client-side rendering) and compiled to WebAssembly by Trunk. It reads MeetCal's data from the Convex queries in `../convex/`, the same ones the app and the CLI read, over Convex's HTTP API (`src/utils/api.rs`). Vercel builds and serves it from this folder (`vercel.json`).

The repository root's `AGENTS.md` applies here too: its hard rules (worktrees, no production deploys or data writes without authorization, never push to `master`) and its PR workflow. This file adds what is specific to the website and names where it differs.

## Differences from the root

- The toolchain is Cargo, Trunk and mise (`mise.toml` in this folder), not Bun. The Playwright tests use **npm** (`package.json`, `package-lock.json`); this folder is the one exception to the root's "never use npm" rule.
- The root's `mise run check` runs this folder's Cargo format, clippy and tests when the branch changes `web/`, one worktree at a time. It does not run the Trunk build or the browser tests; run those from [Verify](#verify).
- A change to a Convex query in `../convex/` can change what this site shows. The Web CI runs on changes to `convex/` for that reason; when you change a query's answer, check the pages that read it (`src/pages/comp_data/`).

## Layout

| Path | Role |
|---|---|
| `src/main.rs` | The router: every route, and which ones sit behind `SubscriptionGate` |
| `src/utils/api.rs` | The only data access: every Convex query the site reads (`queries::*`), which of them carry the access pass, the HTTP call with its retries, and fetching and holding the pass (`accessPass:pass`, with `entitlements:refresh` when Convex does not know the subscriber yet) |
| `src/auth.rs`, `src/auth_bridge.js` | Clerk sign-in and the RevenueCat entitlement check, through a small JavaScript bridge to the providers' web SDKs |
| `src/components/` | Header, footer, feature cards, route metadata (`seo.rs`), the subscription gate |
| `src/pages/` | Public pages (home, features, privacy, terms). `/atlas` redirects to the Atlas home page at atlas.meetcal.app, which the Atlas repository serves |
| `src/pages/comp_data/` | The competition data pages, one file each, plus their shared pieces: `models.rs` (answer types), `loading.rs`, `filters.rs`, `format.rs`, `ui.rs`, `catalog.rs` (the data page list) |
| `styles.css` | All styling |
| `index.html`, `scripts/generate-bootstrap.sh` | The page shell, and the post-build hook that writes the Wasm bootstrap and one metadata shell per route under `dist/seo/` |
| `vercel.json` | Build command, security headers (the CSP), and the rewrites that serve each route's metadata shell |
| `tests/e2e/` | Playwright: routes, layout, accessibility, security headers, visual baselines, and the data pages against mocked Convex answers |
| `tests/config/` | Node tests of `vercel.json` and the built shells |
| `docs/` | [architecture.md](docs/architecture.md) (how the pieces fit, and adding a page), [testing.md](docs/testing.md) |

## Commands

Run from this folder.

| Task | Command |
|---|---|
| Dev server (http://localhost:3000) | `mise run run` |
| Format (Leptos `view!` included) | `mise run fmt` |
| Lint | `mise run lint` (`cargo fmt --check` + `clippy -D warnings`) |
| Rust tests | `cargo test --locked` |
| Rust gate | `mise run check-all` |
| Release build | `mise run build` (into `dist/`) |
| Browser tests | see [docs/testing.md](docs/testing.md) |
| Dependency audit | `mise run audit` and `npm audit --audit-level=high` |

`CLERK_PUBLISHABLE_KEY` and `REVENUECAT_PUBLIC_API_KEY` are read at compile time (`.env.example`); without them the data pages show a configuration error instead of the sign-in. `MEETCAL_CONVEX_URL`, also compile time, points a build at another Convex deployment; unset, it reads production, and production's CSP only allows the production deployment.

## Verify

Run before opening or updating a PR that touches this folder:

| Gate | Command | Pass when |
|---|---|---|
| Rust | `mise run check-all` | Exit 0 |
| Release build | `CLERK_PUBLISHABLE_KEY=pk_test_e2e REVENUECAT_PUBLIC_API_KEY=rcb_e2e mise exec -- trunk build --release --locked` | Exit 0 |
| Config | `npm run test:config` | Exit 0 |
| Browser tests | `npm run typecheck` then `npm run test:e2e` | Exit 0; WebKit runs in CI if it is not installed locally |

CI (`.github/workflows/web.yml` at the root) runs the same gates plus both audits. A UI change should come with a screenshot or a running demo when asked.

## Code Quality

- Every data call goes through `src/utils/api.rs`: add a query to `queries`, never build a Convex URL in a page. Arguments are the query's own, camelCase; use `#[serde(rename_all = "camelCase")]` on argument structs.
- Answer types live beside the page that reads them (or in `models.rs` when shared). Fields a newer answer adds and an older one lacks are `#[serde(default)]` optionals, so a deploy and a view rebuild can land in either order.
- Pages load through `loading.rs`: a `Load` (or `load_query`) per answer, keyed by the request, read with `table_response` / `select_response`: one skeleton, one error line with a Try again button, one empty state. Never read a `LocalResource` directly: it shows the previous answer while the next one loads, and queues each request behind the last.
- Every request has a timeout (`REQUEST_TIMEOUT` in `api.rs`); errors shown to users never name the Convex function.
- The subscription gate is a client-side check over RevenueCat's entitlement, like the app's paywall; Convex is moving to enforce the subscription itself. The premium functions (`SUBSCRIPTION_FUNCTIONS` in `api.rs`, matching `PREMIUM_FUNCTIONS` in `../convex/lib/access.ts`; a test there compares them) take a shared daily access pass as their `pass` argument, which `api.rs` adds; a new premium function goes in that list. For now Convex only logs a premium read without a current pass and still answers it; it will refuse it later. No query carries the user's Clerk session token except `accessPass:pass`, which hands out the pass: a query that reads its caller is cached per user, so the pass keeps every subscriber on Convex's shared query cache. Until enforcement lands the data is still public: do not put anything in a page that must stay private.
- New third-party origins need a CSP entry in `vercel.json` (and the config test that pins it). Keep the CSP as narrow as the feature needs.
- Keep the page and its metadata shell in step: a new route touches several files (see [docs/architecture.md](docs/architecture.md#adding-a-page)).

## Recurring lessons

- A pass problem must never break a page while Convex only logs: a read whose pass could not be fetched (signed out, not subscribed, offline) goes out without one, and a read Convex refuses for its pass (a function error with status 401 or 403) fetches a fresh pass and goes once more. `mockAuth` answers `accessPass:pass` and `entitlements:refresh` so no test reaches the real deployment (the mocks' CORS preflight allows their `authorization` header), and a premium read's mocked `args` include `pass` (`pass_test`).
- Convex's HTTP API writes the numbers of a value answer as floats (`2.0`). `api.rs` turns whole numbers back into integers so integer fields parse; answers sent as JSON text (`{ json }`) never had the problem. Mocks in tests use integers, so they cannot catch a regression here: keep the unit test in `api.rs`.
- A Convex view is fresh while its source tables are unchanged, whatever code built it. A page that needs a new field from a view-backed answer will not see it on production until the view is rebuilt (`../docs/backend.md`).
- Every read is a JSON `POST`, so the browser sends a CORS preflight first. Playwright mocks must answer `OPTIONS` (`routeQuery` in `tests/e2e/support/api.ts` does).
- `trunk serve` has no CSP; only a Vercel deploy (or `tests/e2e/security.spec.ts`) shows a CSP violation.
