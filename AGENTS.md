# MeetCal Mobile

Expo / React Native app for USA Weightlifting meet schedules, start lists, results, and offline-first companion data. The phone talks to a self-hosted Rust + Postgres API at `https://api.meetcal.app` through `lib/api/meetcal-api.ts`. There is no Convex backend in this app.

Sister repos (do not implement them here): `meetcal-backend` (API + Postgres), `meetcal-web`, `meetcal-cli`.

## Layout

| Path | Role |
|---|---|
| `app/` | Expo Router screens (tabs, auth, shared sheets, competition data) |
| `components/` | Feature UI. Screens should stay thin and call into `lib/`, `hooks/`, `utils/` |
| `hooks/` | Data and device hooks (`useSavedSessions`, schedule pagination, OTA) |
| `lib/api/` | HTTP client, URL building, response mapping, timeouts |
| `lib/database/` | Offline cache, meet prefetch/warm, query facades over the API |
| `lib/` | Auth cache, network, start-list helpers, PostHog, estimator |
| `utils/` | Timezone/date, deep links, notifications, widgets, auth guard |
| `contexts/` | Selected meet, saved sessions, theme, RevenueCat subscription |
| `types/`, `data/types/` | Shared domain types |
| `targets/`, `widget/` | Native iOS/Android home-screen widgets |
| `scrapers/` | Legacy Python/JS scrape trees. Out of scope for app reliability work; do not re-litigate Convex removal here |
| `.maestro/` | Device smoke flows |
| `.codex/skills/` | Agent skills, including the three-pass review skill |

## Commands

Package manager is **bun**. Do not use npm.

| Task | Command |
|---|---|
| Install | `bun install` |
| Dev client | `bun run start` / `bun run dev` |
| Lint | `bun run lint` |
| Typecheck | `bun run typecheck` (or `bunx tsc --noEmit`) |
| Unit tests | `bunx jest --ci --watchman=false` |
| Watch tests | `bun run test` |
| Coverage | `bun run test:coverage` |
| Coverage gaps | `bunx tsx .codex/skills/review-code-performance-tests/scripts/report-coverage-gaps.ts` |
| Maestro | `bun run maestro:test` (needs a booted simulator + Metro; see `docs/testing.md`) |
| iOS / Android | `bun run ios` / `bun run android` |
| Prod OTA | `bun run update:prod` (production only) |

## Verify

Run this table before opening or updating a PR. Do not merge. Do not push to `master`.

| Gate | Command | Pass when |
|---|---|---|
| Lint | `bun run lint` | Exit 0 |
| Typecheck | `bun run typecheck` | Exit 0 |
| Unit tests | `bunx jest --ci --watchman=false` | Exit 0 |
| Coverage inventory | `bun run test:coverage` then the gaps script | Report written; no new untested auth/API/timezone holes in files you touched |

Maestro is optional in CI. Run it when a change touches navigation, auth gates, or a screen a flow already covers.

## Code Quality

- Screens orchestrate. Policy, mapping, and fetching live in `lib/` / `utils/` / `hooks/`.
- Validate at the API boundary (`lib/api/meetcal-api.ts`) before data reaches UI or AsyncStorage.
- Prefer indexes and batch endpoints over per-row HTTP. Name-list calls must chunk.
- No unbounded `Promise.all` over meet-sized collections that inflate/deflate offline blobs.
- `unknown` at parse sites, then narrow. Do not `as T` past a `JSON.parse`.
- Auth and subscription gates are server-checked via Clerk JWT + RevenueCat; the client cache is a hint, never a source of truth for writes.
- Time and dates go through `utils/timezone.ts` / `utils/dateTime.ts`. Do not use the device timezone for meet-local instants.
- Scrapers, native widget binaries, and generated `ios/` `android/` trees are not part of the JS reliability gate.

## Reliability Guideposts

### NASA Power of Ten (adapted)

1. **Simple control flow.** No clever hidden state machines in screens. Effects have cancellation flags.
2. **Bounded loops.** Batch/chunk network and decode work. Never `collect()` a whole federation in one parse.
3. **No dynamic allocation surprises on the hot path.** Cap cached arrays; FlashList for long lists.
4. **Declare sizes.** Timeouts (`DEFAULT_TIMEOUT_MS`), chunk sizes, cache TTLs are named constants.
5. **Check returns.** `fetch` + `JSON.parse` + shape checks. Empty body and non-JSON are errors.
6. **Data hiding at boundaries.** Map API snake_case into app types in one place.
7. **Check return values of calls.** Timeouts, 404 vs network error, and Clerk `getToken()` failure are distinct.
8. **Limit preprocessor / magic.** One API base URL, one mapper family.
9. **Limit pointers / aliases.** Don't keep a second copy of meet time policy in a screen.
10. **Compile with warnings; test the edges.** Lint + `tsc --noEmit` + Jest, including malformed payloads.

### TigerStyle (adapted)

- **Problems, not solutions.** Measure a waterfall or a dropped session before "refactoring" a screen.
- **Assertions.** Invalid timezone, empty token, non-array `sessions` — fail loudly in the client mapper.
- **Explicit vs implicit.** Meet-local time is always IANA + wall clock, never `Date` parsed from `YYYY-MM-DD` as local.
- **Zero, one, many, max.** Empty name lists short-circuit. Huge name lists chunk. Widget rows cap.
- **Design for failure.** Offline cache and stale auth are fallbacks with expiry, not silent success.
- **Show your work.** Slow API logs in `__DEV__` (`[perf] slow api request`). Keep them off production noise.

## Recurring lessons

- Meet dates are calendar dates in the meet timezone. `new Date("2026-06-20")` is UTC midnight and will drift in US zones if you then read local `getDate()`.
- Device `getTimezoneOffset()` is not the meet offset. Use `getOffsetMinutesAtInstant` / `convertZonedLocalToUTC`.
- Clerk may still be loading while the user is offline. `useAuthGuard` may trust the 7-day SecureStore cache only for *reads*; it must not skip sign-in for writes when the cache is stale and the network is up.
- Prefetch of athlete history is sequential on purpose (watchdog / memory). Do not fan out pako inflate with `Promise.all`.
- `useSavedSessions` is a god-hook. New session policy goes into testable functions (`lib/next-session.ts`, `utils/time.ts`), not another closure inside the hook.
- `as any` on `router.push` hides Expo Router param bugs. Prefer typed `Href`.
- Maestro sets `EXPO_PUBLIC_MAESTRO_E2E=1` and bypasses auth. Never ship that bypass outside `__DEV__`.
- Ignore `scrapers/` unless the task is scrape-specific. The Convex-removal PR is a different branch; do not mix that work here.
