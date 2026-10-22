# MeetCal Mobile

Expo / React Native app for USA Weightlifting meet schedules, start lists, results, and offline-first companion data. The backend is Convex, in `convex/` in this repo: the app reads it through `src/lib/api/meetcal-api.ts` (transport in `src/lib/api/transport.ts`); materialized views keep answers fast (`convex/lib/views.ts`, `convex/views.ts`); scheduled scrapers keep the data current (`convex/cronJobs.ts`, `convex/scrapers/`). The iOS App Intents call the same queries over Convex's HTTP API (`plugins/ios-app-intents/MeetCalAPI.swift`). How writes keep the derived data (views, histories, summaries, search) current, and what to run after a write that bypasses `convex/ingest.ts`, is in `docs/backend.md`.

## Hard Rules

- Use Bun for JavaScript. Run commands through `mise run <task>` or `mise exec -- <command>` so this repo's Bun and Node versions apply. Never use npm.
- Do not read `.env*` contents unless the user authorizes it. Do not deploy Convex, publish an OTA, submit a build, or write production data unless the current task authorizes that action.
- Start Metro and drive the simulator only through the package scripts (`bun run start|dev|ios|android|web|maestro:test`) or their `mise run app:*` tasks, never a bare `bunx expo start` / `expo run:*` / `maestro test`: the scripts take the [simulator lock](#simulator-lock).
- Do not edit generated `ios/` or `android/` trees as a lasting source change. Do not patch dependencies to work around app defects without a documented reason.
- Work in the session's dedicated worktree. If the session starts in a primary checkout, create a worktree before editing. Preserve unrelated user changes.

## Workflow

1. Grill the plan first. Before making code edits for a new feature, a change to a core item, or any other large-scale operation, run the `grill-me` skill and do not edit until the user confirms you share an understanding of the plan. `grill-me` is user-invoked only, so an agent loads `grilling`, the skill it delegates to. Tiny code fixes skip this. Both skills are vendored from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT); refresh them from upstream instead of editing them here.
2. Read the relevant source, tests, and docs before changing behavior. Check the current branch and worktree state. Sync with the target branch when safe; do not rebase over uncommitted work.
3. Use the smallest relevant checks while implementing. Run every change that affects app behavior on a device as soon as it runs, before the full gate, following [Device testing](#device-testing); fix what the user flags, then continue. Documentation-, tooling-, website- and CLI-only changes skip it; say so in the PR test plan.
4. For risky changes to auth, subscription gating, writes, navigation, offline data, or native/platform behavior, ask a subagent to review the diff with the `review-code-performance-tests` skill after implementation; fix confirmed findings. Keep the review scoped to the change.
5. Before opening or updating a PR, run `mise run check`. A documentation-only change may skip it; say so in the PR test plan. Run Maestro for navigation, auth gates, or screens its flows cover when a suitable device is available.
6. Open or update a PR against `master` when the task calls for one. Use an imperative, user-visible title and `## Summary` and `## Test plan` body sections. Do not merge or push directly to `master`.
7. Report what changed, verification results, untested devices or flows, data/schema or auth changes, and remaining risks. Leave a harness-created worktree in place.

`CLAUDE.md` imports this file for Claude Code. Keep shared repository rules here; the review skill holds its specialized audit procedure.

The website (meetcal.app, Rust + Leptos compiled to WebAssembly) is in `web/` and reads the same Convex queries over Convex's HTTP API (`web/src/utils/api.rs`). It has its own toolchain and gates (Cargo and Trunk, and npm for its Playwright tests, the one exception to the Bun rule): see `web/AGENTS.md`, which applies with this file for work in `web/`. The app's lint, typecheck, Jest, Metro and EAS all skip `web/`.

The CLI (`meetcal`, distributed through Homebrew) is in `cli/` and reads the same Convex queries over Convex's HTTP API (`cli/src/utils/backend.rs`). It builds with Cargo (`mise run check-all` from `cli/`) and releases from `cli-vX.Y.Z` tags; `cli/AGENTS.md` applies with this file for work in `cli/`, and `cli/docs/releasing.md` has the release and Homebrew steps. Metro, EAS and the app's CI skip `cli/`.

`meetcal-backend` (the retired Rust API + Postgres) is being sunset.

## Layout

The app's code is in `src/`, Expo's project layout; the repository root holds the other projects (`convex/`, `web/`, `cli/`) and the app's build tooling. `@/` imports resolve to `src/` (`@/lib/api/meetcal-api`), except `@/assets/`, which is the root `assets/` folder (`tsconfig.json` and `babel.config.js` declare both). A path named in a comment inside `src/` is relative to `src/`; elsewhere, paths are relative to the repository root.

| Path | Role |
|---|---|
| `src/app/` | Expo Router screens (tabs, auth, shared sheets, competition data) |
| `src/components/` | Feature UI. Screens should stay thin and call into `src/lib/`, `src/hooks/`, `src/utils/` |
| `src/hooks/` | Data and device hooks (`useSavedSessions`, schedule pagination, OTA) |
| `src/lib/api/` | HTTP client, URL building, response mapping, timeouts |
| `src/lib/database/` | Offline cache, meet prefetch/warm, query facades over the API |
| `src/lib/` | Auth cache, network, start-list helpers, PostHog, estimator |
| `src/utils/` | Timezone/date, deep links, notifications, widgets, auth guard |
| `src/contexts/` | Selected meet, saved sessions, theme, RevenueCat subscription |
| `src/types/`, `src/data/types/` | Shared domain types |
| `src/data/meets/` | A meet's resolved configuration (time zone, dates) for calendar exports and session notifications |
| `src/config/` | Development switches (`development.ts`), the dev mock meet, version announcements |
| `src/constants/` | Colors and palette, layout tokens, platform ordering, ranking and adaptive constants |
| `assets/` | Images, fonts, app icons (referenced by `app.config.js`) |
| `plugins/` | Expo config plugins and the native sources they install: iOS App Intents (`plugins/ios-app-intents/`), the saved-sessions widgets, AsyncStorage size, version sync |
| `targets/`, `widget/` | Native iOS/Android home-screen widgets |
| `scripts/`, `jest/`, `patches/` | Dev scripts, the Jest device-time-zone environment, dependency patches |
| `convex/` | Backend: queries, ingest mutations, views, crons, scrapers (`convex/scrapers/`). Tests in `convex-tests/`. Deploy with `npx convex deploy`. See `docs/backend.md` |
| `web/` | The website: Rust/Leptos (Trunk build, Vercel deploy, Playwright tests). Changing a Convex query's answer changes the site too: check `web/src/pages/comp_data/` |
| `cli/` | The `meetcal` CLI: Rust, released to Homebrew. Changing a Convex query's answer changes the CLI too: check `cli/src/commands/` |
| `.maestro/` | Device smoke flows |
| `.codex/skills/` | Agent skills, including the three-pass review skill |

## Commands

Package manager is **bun**, pinned in `mise.toml`. Do not use npm.

| Task | Command |
|---|---|
| Install | `bun install` |
| Install from lockfile | `mise run setup` |
| Full local PR gate | `mise run check` (`-- --plan` to see what it will run, `-- --all` for every suite) |
| Dev client | `bun run start` / `bun run dev` |
| Lint | `bun run lint` |
| Typecheck | `bun run typecheck` (or `bunx tsrs --noEmit`) |
| Unit tests | `bunx jest --ci --watchman=false` |
| Watch tests | `bun run test` |
| Coverage | `bun run test:coverage` |
| Coverage gaps | `bun .codex/skills/review-code-performance-tests/scripts/report-coverage-gaps.ts` |
| Maestro | `bun run maestro:test` (needs a booted simulator; starts its own E2E Metro; see `docs/maestro.md`) |
| iOS / Android | `bun run ios` / `bun run android` |
| iOS for iPhone Duo | `DEVELOPER_DIR="/Applications/Xcode copy.app/Contents/Developer" bun run ios --device <duo-udid>` (needs the iOS 27.1 SDK; see `docs/iphone-duo.md`) |
| Prod OTA | `bun run update:prod` (production only) |

Type checking uses [tsrs](https://github.com/oxc-project/tsrs), the Rust port of the TypeScript 7 compiler, here and in `web/`. The `typescript` 6 package stays installed only for ESLint (typescript-eslint does not support TypeScript 7) and for the Convex CLI's own deploy-time typecheck, which can only run `tsc` or `tsgo`; do not use it for type checking.

`mise tasks ls` lists the app, Convex, build, submit, update, and compatibility tasks. Build, submit, deploy, and update tasks have external side effects; run them only when authorized. The EAS iOS build task uses the cloud image; use the local Xcode 27.1 path in `docs/iphone-duo.md` for a Duo-optimized store build.

`runtimeVersion` in `app.config.js` is the native project's fingerprint (`fingerprint.config.js` adds our own native sources to it), so an OTA update only reaches binaries whose native code matches the commit it was published from. Any native change (a dependency, config plugin, our own native sources, or the Expo / React Native version) needs a new binary; `package.json` scripts and `.gitignore` are left out of the hash. The fingerprint includes `EXPO_PUBLIC_CONVEX_URL`, which is written into the iOS Info.plist, so publish updates with the URL of the build they target set, as the `app:update:*` mise tasks do; otherwise the update matches no build. `bunx expo-updates fingerprint:generate --platform ios` prints the hash and its sources.

## Verify

Run `mise run check` before opening or updating a PR. It runs only the suites the branch changes need (`scripts/check/plan.ts`): for the app and `convex/`, lint, typecheck, Jest coverage and the coverage-gap inventory; for `web/` and `cli/`, their Cargo format, clippy and tests. It holds a lock shared by every worktree, so a second gate (or a full Jest run through `mise run app:test`) waits instead of running alongside it; concurrent gates have run this machine out of memory. Run full Jest suites through `mise run check` or `mise run app:test`, not a bare `bunx jest` with no path. Do not merge or push to `master`. Use the individual commands below, scoped to the files you touched, while iterating.

| Gate | Command | Pass when |
|---|---|---|
| Lint | `bun run lint` | Exit 0 |
| Typecheck | `bun run typecheck` | Exit 0 |
| Unit tests | `bunx jest --ci --watchman=false` | Exit 0 |
| Coverage inventory | `bun run test:coverage` then the gaps script | Report printed; no new untested auth/API/timezone holes in files you touched |

Jest includes `convex-tests/`, but its coverage report does not measure `convex/` production functions or native widget binaries. Follow `docs/backend.md` for Convex write verification and `docs/testing.md` for test placement and device-timezone behavior. A green local gate does not prove iOS/Android rendering, push delivery, RevenueCat purchases, or production data migrations.

Maestro is optional in CI. Run it when a change touches navigation, auth gates, or a screen a flow already covers.

## Device testing

A change that affects app behavior is done when it has run on a device and, for a UI change, its screenshots are in your chat reply.

1. **Pick the machine.** The MacBook comes first: check it with `ssh -o ConnectTimeout=5 maddisenmohnsen@macbook true`. When it answers, run iOS there, and Android too when the change is platform-specific. When it does not, boot an Android emulator on this Linux machine (`emulator -list-avds`, then `emulator -avd <name>`). iOS-only code (`targets/`, `widget/`, `plugins/ios-app-intents/`, iPhone Duo layout) needs the MacBook; when it is unreachable, say in your reply and the PR that iOS is untested.
2. **Get the code to the MacBook.** Its login shell is fish, so run POSIX commands as `ssh maddisenmohnsen@macbook 'bash -lc "…"'`; export `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` first, or CocoaPods fails in the SSH session. The checkout is `~/dev/meetcal-llc/meetcal`. `git fetch` from GitHub fails in an SSH session there, so push from here: `git push maddisenmohnsen@macbook:dev/meetcal-llc/meetcal <commit>:refs/heads/<branch> origin/master:refs/remotes/origin/master`. Work in a separate worktree there (never switch the branch of its main checkout), run `mise run setup`, and copy the main checkout's `.env.local` into it without reading it. Remove the worktree, branch and pushed refs when you are done.
3. **Run it.** `bun run ios` or `bun run android` on the machine that owns the device, so it takes that machine's [simulator lock](#simulator-lock).
4. **Show it.** Open the device in T3 Code's device panel (`device_open`, when `device_list` shows it) so the user can drive it. For a UI change, screenshot each changed screen and state, and embed the images in your chat reply as Markdown images with absolute paths: `xcrun simctl io booted screenshot <file>` on the MacBook (copy it back with `scp`), `adb exec-out screencap -p > <file>` on Linux, or T3's `device_screenshot`.
5. **Stop your Metro** so the next agent gets the simulator.

### Simulator lock

One simulator or emulator and one Metro port (8081) serve every worktree on a machine, so the package scripts take a lock per machine (`scripts/metro-lock.ts`), shared with Atlas:

- Another worktree holds it: the command prints who, and when their lease ends, every 30 seconds, then starts by itself. Run Metro in the background and wait; leave other worktrees' Metro running, and do not ask the user to pick which agent gets the simulator.
- Your own worktree's Metro is still running: the command exits. Stop that Metro first; `maestro:test` starts its own.
- Port 8081 is taken by a process outside the lock: the command exits, naming it and its directory.
- A session is stopped after a 30-minute lease; set `METRO_SIMULATOR_LEASE_MIN=60` before starting for a longer one.

Mechanics and tests are in `docs/testing.md`.

## Code Quality

- Screens orchestrate. Policy, mapping, and fetching live in `src/lib/` / `src/utils/` / `src/hooks/`.
- Validate at the API boundary (`src/lib/api/meetcal-api.ts`) before data reaches UI or AsyncStorage.
- Prefer indexes and batch endpoints over per-row HTTP. Name-list calls must chunk.
- No unbounded `Promise.all` over meet-sized collections that inflate/deflate offline blobs.
- `unknown` at parse sites, then narrow. Do not `as T` past a `JSON.parse`.
- Auth for `/users/me/*` is server-checked via Clerk JWT. Premium competition data (`PREMIUM_FUNCTIONS` in `convex/lib/access.ts`) is gated on the server by a shared daily access pass that only callers with an active `Subscriptions` entitlement can get (`convex/accessPass.ts`); premium reads send it as their `pass` argument and never read the caller, so Convex's cache stays shared. The gate only logs reads without a current pass until `PREMIUM_MODE` is `enforce`. The app's list (`src/lib/api/premium-queries.ts`) and the website's, the CLI's and Siri's (`plugins/ios-app-intents/MeetCalAPI.swift`, which gets the pass with the token `src/lib/siri-token.ts` stores) are kept equal to the server's by tests; schedules, start lists, meet lists and Weightlifting Wrapped (`results:wrapped`, stats only, scored in `convex/lib/wrapped.ts`) stay public. The client-side paywall decides UI only, and the cached auth/subscription state (SecureStore) is a hint, never a source of truth for writes. See `docs/backend.md`.
- Time and dates go through `src/utils/timezone.ts` / `src/utils/dateTime.ts`. Do not use the device timezone for meet-local instants.
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
10. **Compile with warnings; test the edges.** Lint + `tsrs --noEmit` + Jest, including malformed payloads.

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
- `useSavedSessions` is a god-hook. New session policy goes into testable functions (`src/lib/next-session.ts`, `src/utils/time.ts`), not another closure inside the hook.
- `as any` on `router.push` hides Expo Router param bugs. Prefer typed `Href`.
- Maestro sets `EXPO_PUBLIC_MAESTRO_E2E=1` and bypasses auth. Never ship that bypass outside `__DEV__`.
- iPhone Duo / iOS 27: the app is resizable and the inner display ignores `orientation: 'portrait'`. Branch on `useWindowDimensions()` width, never on orientation.
- The Duo reserves an 84pt side band for status items and the floating tab rail, reported as `insets.left`/`insets.right`. Screens apply it at their outermost container with `useScreenHorizontalInsets()`; only do it once per subtree (chrome inside a screen inherits it, chrome mounted in `src/app/_layout.tsx` does not). See `docs/iphone-duo.md`.
- Width-derived layout must use the *usable* width, not the window. `usePaginatedSchedule` exposes `pageWidth` for this and re-anchors the current page when it changes; new width-derived layout needs the same treatment plus a test.
- Header buttons are native bar items (`unstable_headerLeftItems` / `unstable_headerRightItems`) on iOS so iOS 27 can move them into iPhone Duo's vertical bar; custom React `headerLeft`/`headerRight` stays stuck in the horizontal bar. Keep the React version for Android.
- EAS Build has no Xcode 27 image yet, so cloud builds letterbox on Duo. A Duo-optimized store build must come from a local Xcode 27.1 archive. Run it with `EXPO_PUBLIC_CONVEX_URL=https://disciplined-hare-790.convex.cloud` in the environment: `.env.local` points at the dev deployment, and a variable already set in the shell wins over it (`bun run update:prod` sets it the same way).
- Cold start: nothing may gate the root's first render, and no API request may wait on the server clock sample (`getTrustedNow()` is null until it lands; use `awaitServerClock` for a decision that needs it). The splash is held by `lib/startup-splash.ts` until the first screen settles or 1.5 s pass; new launch-time screens or root dialogs must report to it. See `docs/startup.md`, which also explains the `startup_timing` PostHog event.
- Ignore `convex/scrapers/` unless the task is scrape-specific.
