# Testing

## Unit (Jest)

Jest uses the `jest-expo` preset, the device-time-zone environment below, and `jest.setup.js` (AsyncStorage + NetInfo mocks, and the React Native UI warm-up below).

```sh
bunx jest --ci --watchman=false
bun run test:coverage
bun .codex/skills/review-code-performance-tests/scripts/report-coverage-gaps.ts
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, Jest coverage, and the coverage-gap inventory with the Bun version pinned in `mise.toml`. The `test` script is watch mode and is not the CI gate.

For local PR verification, run `mise run check`. It uses the pinned Bun and Node versions and runs lint, typecheck, Jest coverage, and the coverage-gap report. The report is an inventory to inspect for changed auth, API, and timezone code; it is not a percentage target. `mise run app:test` runs the faster Jest CI suite while iterating. Maestro is a separate device smoke check.

### Device time zone

Jest runs every file on a pinned *device* zone, set by `jest/device-timezone-environment.js` (the `testEnvironment` in `package.json`) before the file loads. The default is `Pacific/Auckland`, so a runner on UTC cannot hide a device-local date bug. Assigning `process.env.TZ` inside a test does nothing (the sandbox gets a copy of `process.env`); pin a file instead:

```ts
/**
 * @jest-environment-options {"deviceTimeZone": "America/Los_Angeles"}
 */
```

Use a US zone to catch UTC midnight read back as local (`new Date("2026-06-20").getDate()` is 19 in Los Angeles) and a far-east zone to catch local midnight read back as UTC. Files that depend on a zone assert it (`Intl.DateTimeFormat().resolvedOptions().timeZone`). To sweep the unpinned files through another zone: `JEST_DEVICE_TIME_ZONE=Asia/Kolkata bunx jest --ci --watchman=false`.

Put tests next to the module they cover (`src/lib/api/meetcal-api.test.ts`, not a parallel `__tests__` tree). The exception is `src/app/`: Expo Router turns every file under `src/app/` into a route, so a test there is bundled into the app along with `react-test-renderer` and its `jest.mock` calls. Screen and route tests live in `src/components/<feature>/` and import the screen from `@/app/...` (for example `src/components/athlete-results/attempt-estimator-route.test.tsx`).

### Cold-cache timeouts and the UI warm-up

`react-native`'s exports are lazy getters. On a cold transform cache (every CI run) the first access to `Animated` costs about 2.3s and `ScrollView`/`Pressable` about 0.7s, which used to land inside whichever test rendered first and push it past Jest's 5s timeout. `jest.setup.js` touches those modules during setup, outside any test's timeout, in `.tsx`/`.jsx` suites only; the environment sets `__MEETCAL_WARM_RN_UI__` from the test path so `.ts` suites skip the cost. A test that renders React Native UI must therefore live in a `.tsx` file. When a test is slow on CI, find what it pays for on first use; do not raise its timeout. To approximate a CI runner: `bunx jest --ci --watchman=false --no-cache --maxWorkers=2`.

### Property and chaos tests

Property tests ([fast-check](https://fast-check.dev)) check a rule over generated inputs instead of a few examples: a mapper either rejects a payload or returns a valid app type, a meet-local time survives a round trip through UTC, a deep link never leaves the app. Chaos tests run a flow under a generated plan of failures and assert how it degrades: it falls back to an expiring cache, reports a typed error, keeps a write queued. Neither asserts that a flow succeeds under failure.

Name them `<module>.property.test.ts` and `<module>.chaos.test.ts`, next to the module, so the nightly run finds them, and import fast-check as a namespace (`import * as fc from 'fast-check'`; the default import trips lint). Shared pieces live in `src/test-support/` (test-only; the app never imports it):

- `arbitraries.ts`: meet time zones (DST, half-hour offsets, both sides of the date line), calendar dates biased to DST changes and leap days, clock strings, hostile strings and values, and `corruptedArb(valid)`, which breaks one node of a valid payload.
- `chaos.ts`: `installChaosTransport` (faults from `src/lib/api/chaos-transport.ts`: network failure, hang until aborted, delay, HTTP status, Convex "try again later", garbage answer, truncated JSON), `installStorageChaos` (AsyncStorage: rejection, full disk, lost write, corrupted read), `createChaosSecureStore`, `chaosGetToken` (Clerk returns null, empty or throws) and `setNetInfoState`. A plan is a list of faults used one per call; once it runs out, calls pass, so a flow always gets a healthy tail to recover on. Plans with `hang` or `delay` need fake timers; `settlingTransportFaultArb` leaves them out.
- `time-arbitraries.ts`: meet-local wall clocks biased to DST gaps and overlaps, clock strings in every accepted spelling and out of range, and oracles that read a zone's wall clock and offset through their own `Intl` formatter, so a time property never checks `utils/timezone` against itself.
- `device-zone-properties.ts`: the calendar-date properties that must not move with the device zone, in one `describeDeviceZoneProperties(zone)`. Each `src/utils/dateTime.*property.test.ts` file pins one device zone (Auckland, Los Angeles, Kolkata, Santiago) and calls it.

To watch the real app degrade under the same transport faults on a simulator, set `DEV_CONFIG.CHAOS` in `src/config/development.ts` (documented there): a development build then fails a share of backend calls at random and logs each fault as `[chaos]`. It never touches a release build, Maestro runs, the server-clock sample or a transport installed with `setApiTransportForTests`.

Each run uses fast-check's 100 cases and a fresh seed, so the gate keeps exploring. A failure prints the shrunk counterexample with its seed and path; replay it exactly, then keep the counterexample as an example test next to the property:

```sh
FC_SEED=<seed> FC_PATH=<path> bunx jest --ci --watchman=false src/utils/timezone.property.test.ts
FC_NUM_RUNS=5000 bunx jest --ci --watchman=false --testPathPattern '\.(property|chaos)\.test'
```

`FC_NUM_RUNS` above 100 also raises Jest's per-test timeout in proportion (`jest.setup.js`), so a deep local run is not cut off at 5s. `.github/workflows/fuzz-nightly.yml` runs the property and chaos suites at 2,000 cases each every night and opens an issue when one fails.

Risk cases that belong in unit tests:

- API mapper validation (malformed JSON, empty lists, missing fields)
- Auth cache and saved-session payloads
- Meet timezone conversion (DST, invalid clock strings)
- Error propagation from `MeetCalApiError` vs timeout vs 404

## Maestro

Device smoke coverage for routes. See `docs/maestro.md`. Not part of GitHub Actions CI.

## What not to do

- Do not pad coverage with screenshot-only tests.
- Do not call a real Convex deployment from Jest; use the transport stub (`src/lib/api/json-transport-stub.ts`).
- Do not exercise `convex/scrapers/` network code in the app unit gate (their parsers are tested in `convex-tests/`).
