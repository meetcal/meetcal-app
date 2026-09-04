---
name: review-code-performance-tests
description: Three ordered passes over MeetCal mobile production surfaces — code, performance, then tests. Use after substantive changes or when asked to harden reliability. Do not merge; open or update a PR only.
---

# Review: code, performance, tests

Run three passes in order against production JS/TS surfaces that ship in the app:

`app/`, `components/`, `hooks/`, `lib/`, `utils/`, `contexts/`

Out of scope unless the task names them: `scrapers/`, native `widget/` / `targets/` binaries, generated `ios/` / `android/`, and any Convex-removal work on other branches.

The app talks to Postgres through `https://api.meetcal.app` via `lib/api/meetcal-api.ts`. There is no Convex. Package manager is bun.

Do not merge. Do not push to `master`. Open one PR against `master` with evidence.

## Pass 1 — Code check

Hunt for:

- Dead code and unused exports on the runtime path
- Unbounded loops / unbounded `Promise.all` over meet-sized data
- Hidden policy in screens that belongs in `lib/` or `utils/`
- Unsafe `as T` / `as any` past `JSON.parse` or fetch
- Missing validation at API and auth boundaries (token, saved sessions, preferences, search, meet package)
- Duplicated time/timezone/meet-name policy
- Control flow that cannot fail closed (empty body treated as success, 404 vs network mixups)

Fix what is bounded. Add regression tests next to the change. Defer the rest in the PR body.

NASA Power of Ten + TigerStyle from `AGENTS.md` apply.

## Pass 2 — Performance check

Evidence-based only. Do not invent Convex insights, query planners, or website coverage.

Measure or trace:

- RN render cost: list virtualization (`FlashList`), extra re-renders from context, work in render
- API waterfalls vs batch/package endpoints (`/meets/package`, batched `/lifting-results/by-names`)
- Name-list URL size (chunk)
- Offline inflate/deflate and prefetch batching (`HISTORY_DOWNLOAD_BATCH_SIZE`)
- Auth/network cache stampedes (`inFlight` maps in `lib/authCache.ts`, `lib/networkUtils.ts`, `lib/database/queries.ts`)

Use `__DEV__` slow-API logs (`[perf] slow api request`) and existing in-flight dedupe. Change only with a before/after story.

## Pass 3 — Test check

1. Run `bun run test:coverage` (creates `coverage/lcov.info`).
2. Run `bunx tsx .codex/skills/review-code-performance-tests/scripts/report-coverage-gaps.ts`.
3. Add **risk-based** tests, not percentage padding:

   - Auth boundaries (missing/empty token, malformed saved-session payload, invalid auth cache JSON)
   - Malformed API JSON, empty body, non-array lists, missing fields
   - Empty and max collections (0 names, chunk-threshold + 1 names)
   - Date/timezone for meets (DST, invalid clock, invalid IANA)
   - Error propagation (timeout, 404 vs 500, mapper throw vs UI fallback)

Do not add tests that only snapshot markup to move coverage.

If `tsx` is missing: `bun add -d tsx` is allowed; otherwise run the script with `bun .codex/skills/review-code-performance-tests/scripts/report-coverage-gaps.ts`.

Skip `/home/maddisen/.codex/...` skill-validate paths; they are not in this environment.

## Verify / Deliver

1. `bun run lint`
2. `bun run typecheck`
3. `bunx jest --ci --watchman=false`
4. Open **one** PR against `master`. Do **not** merge. Do **not** close with a merge/worktree ritual.
5. PR body lists: passes run, fixes landed, new tests, deferred gaps, command evidence.

If a pass finds the tree already excellent, say so with evidence (commands + why remaining gaps are deferred).
