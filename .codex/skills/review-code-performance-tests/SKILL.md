---
name: review-code-performance-tests
description: Review MeetCal code quality, measured performance, and risk-based test gaps in three ordered passes. Use for repository cleanup, reliability audits, or substantive changes that warrant a focused review.
---

# Review: code, performance, tests

Run three passes in order. For an ordinary change, scope the review to its diff and affected callers. For a full audit, inspect production JS/TS surfaces that ship in the app:

`src/app/`, `src/components/`, `src/hooks/`, `src/lib/`, `src/utils/`, `src/contexts/`

Include non-scraper `convex/` functions when the reviewed change touches backend reads or writes. Out of scope unless the task names them: `convex/scrapers/`, native `widget/` / `targets/` binaries, generated `ios/` / `android/`.

The app reads Convex (`convex/` in this repo) through `src/lib/api/meetcal-api.ts` and `src/lib/api/transport.ts`. Package manager is bun.

Do not merge or push to `master`. If the task calls for a PR, open or update one against `master` with evidence.

## Prepare

Read `AGENTS.md`, `docs/testing.md`, relevant source and tests, and task definitions. Work in the session worktree or create one when needed. Preserve unrelated changes and do not inspect `.env*` contents without authorization. Record the risks and checks relevant to the scope.

## Pass 1 — Code check

Hunt for:

- Dead code and unused exports on the runtime path
- Unbounded loops / unbounded `Promise.all` over meet-sized data
- Hidden policy in screens that belongs in `src/lib/` or `src/utils/`
- Unsafe `as T` / `as any` past `JSON.parse` or fetch
- Missing validation at API and auth boundaries (token, saved sessions, preferences, search, meet package)
- Duplicated time/timezone/meet-name policy
- Control flow that cannot fail closed (empty body treated as success, 404 vs network mixups)
- Duplicated mutable state, unchecked results, unused wrappers, and validation that exists only in UI code
- For touched Convex functions: missing `args` validators, scans where an index exists, unbounded reads, write paths that leave materialized views stale, and authorization on `/users/me/*`

Fix validated, bounded problems. Add a regression test for a corrected behavior when it protects a meaningful boundary. Record remaining risks in the PR body when there is one.

NASA Power of Ten + TigerStyle from `AGENTS.md` apply.

## Pass 2 — Performance check

Evidence-based only. Do not invent query planners or website coverage.

Measure or trace:

- RN render cost: list virtualization (`FlashList`), extra re-renders from context, work in render
- API waterfalls vs batch/package endpoints (`/meets/package`, batched `/lifting-results/by-names`)
- Name-list URL size (chunk)
- Offline inflate/deflate and prefetch batching (`HISTORY_DOWNLOAD_BATCH_SIZE`)
- Auth/network cache stampedes (`inFlight` maps in `src/lib/authCache.ts`, `src/lib/networkUtils.ts`, `src/lib/database/queries.ts`)

Use `__DEV__` slow-API logs (`[perf] slow api request`) and existing in-flight dedupe. Rank hot paths by latency, frequency, payload size, and failure cost. Change only with a before/after story; preserve auth and validation work even when it has a cost.

## Pass 3 — Test check

1. Run `bun run test:coverage` (creates `coverage/lcov.info`).
2. Run `bun .codex/skills/review-code-performance-tests/scripts/report-coverage-gaps.ts`.
3. Cross-check the report against existing tests and add **risk-based** tests, not percentage padding:

   - Auth boundaries (missing/empty token, malformed saved-session payload, invalid auth cache JSON)
   - Malformed API JSON, empty body, non-array lists, missing fields
   - Empty and max collections (0 names, chunk-threshold + 1 names)
   - Date/timezone for meets (DST, invalid clock, invalid IANA)
   - Error propagation (timeout, 404 vs 500, mapper throw vs UI fallback)

Do not add tests that only snapshot markup to move coverage.

Assert user-visible results, stored state, requests, and invariants rather than implementation details. Keep time and network behavior deterministic. Stub external services at their boundaries while exercising MeetCal mapping and policy code. For screen logic, test pure helpers and enough route wiring to prove the screen calls them. Do not call a live Convex deployment from Jest.

## Verify / Deliver

1. Run the smallest relevant checks while iterating.
2. Before opening or updating a PR, run `mise run check`; use `docs/testing.md` for optional device and Maestro checks.
3. If the task calls for a PR, describe passes run, measured findings, fixes, tests, deferred gaps, and command evidence. Do not merge.

If a pass finds no justified change, say so with evidence. Validate this skill after editing with the skill-creator `quick_validate.py` script.
