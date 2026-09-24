# Testing

## Unit (Jest)

Jest uses the `jest-expo` preset, the device-time-zone environment below, and `jest.setup.js` (AsyncStorage + NetInfo mocks, and the React Native UI warm-up below).

```sh
bunx jest --ci --watchman=false
bun run test:coverage
bunx tsx .codex/skills/review-code-performance-tests/scripts/report-coverage-gaps.ts
```

CI (`.github/workflows/ci.yml`) runs lint, `tsc --noEmit`, and `bunx jest --ci`. The npm script `test` is watch mode and is not the CI gate.

### Device time zone

Jest runs every file on a pinned *device* zone, set by `jest/device-timezone-environment.js` (the `testEnvironment` in `package.json`) before the file loads. The default is `Pacific/Auckland`, so a runner on UTC cannot hide a device-local date bug. Assigning `process.env.TZ` inside a test does nothing (the sandbox gets a copy of `process.env`); pin a file instead:

```ts
/**
 * @jest-environment-options {"deviceTimeZone": "America/Los_Angeles"}
 */
```

Use a US zone to catch UTC midnight read back as local (`new Date("2026-06-20").getDate()` is 19 in Los Angeles) and a far-east zone to catch local midnight read back as UTC. Files that depend on a zone assert it (`Intl.DateTimeFormat().resolvedOptions().timeZone`). To sweep the unpinned files through another zone: `JEST_DEVICE_TIME_ZONE=Asia/Kolkata bunx jest --ci --watchman=false`.

Put tests next to the module they cover (`lib/api/meetcal-api.test.ts`, not a parallel `__tests__` tree). The exception is `app/`: Expo Router turns every file under `app/` into a route, so a test there is bundled into the app along with `react-test-renderer` and its `jest.mock` calls. Screen and route tests live in `components/<feature>/` and import the screen from `@/app/...` (for example `components/athlete-results/attempt-estimator-route.test.tsx`).

### Cold-cache timeouts and the UI warm-up

`react-native`'s exports are lazy getters. On a cold transform cache (every CI run) the first access to `Animated` costs about 2.3s and `ScrollView`/`Pressable` about 0.7s, which used to land inside whichever test rendered first and push it past Jest's 5s timeout. `jest.setup.js` touches those modules during setup, outside any test's timeout, in `.tsx`/`.jsx` suites only; the environment sets `__MEETCAL_WARM_RN_UI__` from the test path so `.ts` suites skip the cost. A test that renders React Native UI must therefore live in a `.tsx` file. When a test is slow on CI, find what it pays for on first use; do not raise its timeout. To approximate a CI runner: `bunx jest --ci --watchman=false --no-cache --maxWorkers=2`.

Risk cases that belong in unit tests:

- API mapper validation (malformed JSON, empty lists, missing fields)
- Auth cache and saved-session payloads
- Meet timezone conversion (DST, invalid clock strings)
- Error propagation from `MeetCalApiError` vs timeout vs 404

## Maestro

Device smoke coverage for routes. See `docs/maestro.md`. Not part of GitHub Actions CI.

## What not to do

- Do not pad coverage with screenshot-only tests.
- Do not call production `https://api.meetcal.app` from Jest; mock `fetch`.
- Do not exercise `scrapers/` in the app unit gate.
