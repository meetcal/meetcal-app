# PR 58: additional review rounds 4 and 5

Reviewed from `7e366b8` using `review-code-performance-tests`, with three fixing agents owning screens/components, hooks/contexts, and API/cache utilities. Both rounds followed code, performance, then risk-based test review. The orchestrator reviewed and integrated each diff. No merge or master push.

## Round 4 — `3504279`

- Serialized widget settings commits so an older storage completion cannot overwrite newer filters; deduplication records successfully persisted settings and payloads.
- Cleared previous athlete history when switching to an uncached athlete; guarded resource invalidation from clearing a newer selection and reset rows when params become unavailable.
- Prevented a delayed connectivity probe from overriding a newer network event.
- Moved auth write deduplication inside the serialized queue, rejected invalid timestamps, discarded reads superseded by sign-out, and enforced the documented seven-day offline expiry.
- Validated nested cache accounting entries before eviction.
- Removed the duplicate full-roster read/filter after the session cache helper had already exhausted its fallback. Cache-miss trace: two full-meet reads before, one after; empty/corrupt session entries still fall back to the roster.
- Mocked Clerk in pure auth-policy tests after `--detectOpenHandles` identified its MessageChannel as the Jest worker leak.

Round gate: lint and typecheck exit 0; coverage run passed 47 suites / 398 tests. Coverage gap inventory written.

## Round 5 — `91d0714`

- Validated saved-session persisted fields, preserving valid legacy athlete names while dropping malformed rows.
- Reused one athlete guard at API mapping and cache reads/merges; malformed session rows fall back to the full roster.
- Clamped pagination when a refreshed schedule loses days, rejected invalid targets, and bounded scroll overshoot and zero-width layouts.
- Stopped superseded estimator loads before starting meet-wide history requests or writing their results; cleared previous estimates on a new load.
- Added widget queue failure recovery and stale athlete-response coverage; made resource source reset synchronous during key changes.
- Removed an unused cache type, unused platform helper/imports, and unread chunk-size accumulator.

Performance review retained list virtualization, memoized filtering, bounded name chunks, and sequential history decompression. Cancellation regression proves an abandoned estimator does not start the subsequent meet-wide history request. No speculative performance rewrites.

## Final verification

| Command | Result |
| --- | --- |
| `bun run lint` | Exit 0; 0 errors, 179 warnings |
| `bun run typecheck` | Exit 0 |
| `bunx jest --ci --watchman=false` | Exit 0; 48 suites / 424 tests |
| `bun run test:coverage` | Exit 0; 48 suites / 424 tests; 31.56% line coverage |
| `bun .codex/skills/review-code-performance-tests/scripts/report-coverage-gaps.ts` | Report written; 161 source files, 103 zero/missing, 13 below 50% |
| `git diff --check` | Clean |

Baseline was 43 suites / 381 tests: these rounds add 5 suites and 43 tests. Changed auth/API/cache/pagination behavior has focused regressions; whole-app coverage remains low and is not presented as comprehensive validation.

## Device evidence and deferred gaps

- Used the existing SDK 58 development binary on Atlas iPhone Duo / iOS 27.1 with this worktree's Metro bundle. No new native archive was built.
- Initial simulator migration/toolchain and Metro address failures were recovered using Xcode 27.1 and `localhost`. A provider error during live edits disappeared on cold restart.
- Maestro main-tabs flow reached the schedule and tapped the meet selector, but timed out waiting for `meet-selection-modal`. Smoke is **not passing**; investigate selector/modal interaction on Duo before merging. Remaining flows were not validated.
- Narrowing estimator history to a session requires preserving full-meet cache completeness and remains deferred. Serial Save All writes still need a backend batch endpoint.
- Native folding, purchase/auth integration, calendar permissions, and full offline scenarios remain outside the Jest evidence. Existing preview-SDK/native build caveats in the PR still apply.
- The repository ignores `bun.lock`; a clean install resolved Expo preview.5 from the PR's preview.3 range. Dependency reproducibility remains a separate gap; package ranges were not changed in these rounds.
