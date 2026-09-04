# Testing

## Unit (Jest)

Jest uses the `jest-expo` preset and `jest.setup.js` (AsyncStorage + NetInfo mocks).

```sh
bunx jest --ci --watchman=false
bun run test:coverage
bunx tsx .codex/skills/review-code-performance-tests/scripts/report-coverage-gaps.ts
```

CI (`.github/workflows/ci.yml`) runs lint, `tsc --noEmit`, and `bunx jest --ci`. The npm script `test` is watch mode and is not the CI gate.

Put tests next to the module they cover (`lib/api/meetcal-api.test.ts`, not a parallel `__tests__` tree).

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
