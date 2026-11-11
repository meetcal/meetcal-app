---
name: review-diff
description: Review one MeetCal pull request's diff for bugs, security holes, code quality and cross-surface twins, and report confirmed findings. Use as the review subagent for every pull request that changes code, which finish-work's gate 3 requires.
---

# Review A Diff

You review one change and report; you do not fix, commit, push, merge or spawn subagents. The brief gives you the branch or diff, the task it implements, and its source map (the single source of each rule, limit, label, sentence, data shape and error the change adds, and how each surface reads it). Read the diff with `git diff origin/master...HEAD`, then the code it touches and its callers (`entire graph neighbors --repo . --format agent --symbol <Name> --direction in`, or `rg`). Stay inside the diff and what it reaches; this is not a repository audit (that is the `review-code-performance-tests` skill).

## What To Look For

- **Bugs.** Wrong results, unhandled errors and rejected promises, off-by-one and boundary cases (zero, one, maximum, maximum plus one), ordering ties, retries and partial failures, stale or duplicate data, effects without cancellation.
- **Meet time.** Meet-local instants go through `src/utils/timezone.ts` / `src/utils/dateTime.ts` with the meet's IANA zone, never the device zone or `new Date("YYYY-MM-DD")` read as local; DST edges and past/current/future session selection.
- **Access.** `/users/me/*` reads and writes are checked on the server through Clerk. Every premium read is in `PREMIUM_FUNCTIONS` (`convex/lib/access.ts`), sends the access pass, and never reads the caller; the app's, website's, CLI's and Siri's lists stay equal to the server's. Try a signed-out caller, a caller without a subscription, and a stale cached session doing a write (`useAuthGuard`).
- **Untrusted input.** API responses, scraped pages, AsyncStorage and SecureStore data, and deep links are `unknown` until validated; no `as T` past `JSON.parse`; empty bodies and non-JSON are errors.
- **Data writes.** Awaited writes, bounded reads, indexes over `.filter()`, schema changes that existing documents still satisfy, migrations that are safe to rerun, and writes that keep views, histories, summaries and search current (`docs/backend.md`).
- **Current users.** Anything a shipped app build or OTA runtime, the website, a released CLI version or the Siri intents call that the diff removes, renames or tightens, or a new data shape an old build shows wrong or blank. A change to a Convex query's answer also changes `web/src/pages/comp_data/` and `cli/src/commands/`.
- **Code quality.** AGENTS.md's Code Quality section and Reliability Guideposts, and any code comment the diff adds (AGENTS.md's Hard Rules).
- **Twins.** For each row of the source map, search for the same rule already written under another name, as AGENTS.md's [One Source Across Surfaces](../../../AGENTS.md#one-source-across-surfaces) describes, in the Rust website and CLI and the Swift intents too. A twin the change should have generalized is a finding.
- **Tests.** Each changed behavior has a test that would fail without the change, asserting results and stored state, not implementation details.

## Report

List only findings you confirmed by reading the code or running a focused test, most severe first. Give each one the file and line, what goes wrong, the input or state that triggers it, and the fix you would make. Then list what you checked and found sound, so the author knows the review's reach. Write "No findings" when nothing survived confirmation.
