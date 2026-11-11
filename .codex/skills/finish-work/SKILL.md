---
name: finish-work
description: Finish a MeetCal change once its code runs: run it live, review it, verify it, open the pull request, rebase, and merge it and deploy Convex when every merge gate passes. Use when a task's code works, before opening or updating its pull request, and whenever deciding whether a pull request may merge.
---

# Finish Work

The steps after the code runs, in order. Each points to the skill that does it. A **documentation-only change** (Markdown files, including `AGENTS.md` and `SKILL.md`, and symlinks to them, with no code, config, lockfile or test changes) skips all of them but four: rebase, open the pull request with "Documentation-only: no checks" as its test plan, wait for its GitHub checks, and merge it.

## 1. Run It Live

Run every change that affects app behavior on a device as soon as it runs, before the full gate, with the `device-testing` skill, so the user can judge it without waiting on `mise run check`. Website changes run in a browser against the dev deployment (`mise run run` in `web/`; `web/AGENTS.md`), and CLI changes run the built CLI against dev (`cli/AGENTS.md`). [Gate 7](#merge-gates) lists the devices each surface needs. Fix what the user flags, then continue. Tooling-only changes skip this step; say so in the test plan.

## 2. Review

Start a subagent that runs the `review-diff` skill. Give it only the branch, the task as the user stated it, and the source map (AGENTS.md, Workflow step 4), not this session's reasoning, so its read is not anchored on yours. Fix every finding it confirms. Every pull request that changes code gets one ([gate 3](#merge-gates)).

## 3. Verify

Run the [Verify](../../../AGENTS.md#verify) checks for each area the diff touches, ending with `mise run check`. Never push a pull request without it.

## 4. Open The Pull Request

Before every `git push`, run `entire status` and confirm it says automatic checkpoint pushing is disabled; if not, run `entire configure --local --skip-push-sessions` first (AGENTS.md, [Entire](../../../AGENTS.md#entire)).

Open it with `gh pr create --base master` once the review is fixed and verification passes; use `--draft` only for work you will keep pushing to. Title in imperative sentence case, naming the user-visible outcome, with no type prefix (for example "Keep saved sessions on screen when a write is refused during a sync"). The body has three sections:

- `## Summary`, with the source map: the single source of each rule or value the change adds, how each surface reads it, and each twin it generalized or left. Unrelated fixes needed along the way go in a separate commit and are called out here.
- `## Test plan`: which checks ran, where, and which devices the change ran on.
- `## Merge Gates`: each gate's result and its evidence, kept current with `gh pr edit` until the merge.

## 5. Rebase

`master` moves while you work, so rebase onto it before you hand the work back, every time, including after follow-up changes: `git fetch origin && git rebase origin/master`, then `git push --force-with-lease`. Resolve conflicts by keeping master's change and reapplying yours on top. If the rebase conflicted, or master changed a file your diff also changes, re-run the checks for that area. Repeat the device check too when master changed the code your change renders or depends on, not just the same file. A conflict-free rebase that touches none of your files needs no new checks.

## 6. Write The Risk List

A bulleted list of what makes the pull request risky to merge right now: checks skipped or failing, behavior verified only by unit tests, devices not tried, data or schema changes, auth, premium-gating or access changes, derived data (views, histories, summaries, search) a write may leave stale, anything the review flagged that you did not fix, and any twin left in place. Write "None found" only when you checked each of these. The list feeds the confidence score (gate 8) and goes in your final message.

## 7. Merge When Every Gate Passes

Run the [Merge Gates](#merge-gates). When all eight pass, merge your own pull request, and deploy Convex when it changes what Convex runs, with the `merge-and-deploy` skill. When one fails, do the work it names, go back through the steps it reopens, and run the gates again; repeat until all eight pass. A gate waiting on the user (gate 1) is asked and waited for. Merge a pull request whose gates have not all passed only when the user explicitly asks in the current task. End with the merge commit, what was deployed, the risk list and the confidence score.

## 8. Clean Up

Stop every dev server you started (Metro/Expo, `trunk serve`, `convex dev`) once the work is done; agents in other worktrees may be queued behind your Metro. Check with `lsof -nP -iTCP -sTCP:LISTEN` and kill only processes whose working directory is your worktree, and confirm `simgate status` shows no slot held by it. Remove worktrees you created and run `git worktree prune`. Leave a harness-created worktree (such as a T3 Code worktree) for the harness to remove, because the session is running inside it, but delete what you installed and built in it: run `mise exec -- mbx clean` in `web/` and `cli/` when you built them (it removes the Cargo target that `target` links to), then `rm -rf node_modules web/node_modules` from its root. Those directories take gigabytes in every worktree; `mise run setup` reinstalls the dependencies if follow-up work needs them.

## Merge Gates

The agent that wrote a pull request may merge it, and deploy Convex when its diff changes what Convex runs, once every gate below passes on the branch as it will land: after the last rebase (step 5), with the PR's `## Merge Gates` section recording each result and its evidence. Each gate passes or fails; none is waived, and a change after a gate passed (a review fix, a rebase that conflicted, new UI) reopens every gate it touches. The approval covers only your own pull requests, never another agent's, and a hold the user put on a pull request or a "don't merge" in the task still stands.

1. **UI approved.** The diff changes nothing a user sees in the app, on the website or in the CLI's output; or the user has seen screenshots of every changed screen on every surface it touches, in this thread, and approved them in their own words. Ask for the approval directly (in Claude Code, with the question tool) once the screenshots are in the chat. A UI change after the approval needs new screenshots and a new approval.
2. **Checks pass.** `mise run check` passes on the final commit, and every GitHub check on the pull request is green (`gh pr checks <number>`). A failure that also fails on a clean `origin/master` is fixed in its own pull request, which lands first.
3. **Reviewed.** A fresh subagent ran the `review-diff` skill on the final diff, and every finding it confirmed is fixed.
4. **Does what the task asked.** You have compared the diff with the task line by line: everything the task asked for is done and has a test, a device run or a check that shows it, and nothing it did not ask for is in the diff.
5. **One source across surfaces.** The source map has a row for every rule, limit, label, sentence, data shape and error; each has one source every surface reads (AGENTS.md, [One Source Across Surfaces](../../../AGENTS.md#one-source-across-surfaces)), and the tests that keep copies equal (such as the premium-function lists) pass. A twin may stay only where the feature itself differs between surfaces, with that reason in the summary.
6. **Current users keep working.** Nothing breaks for anyone on a shipped app (the oldest App Store and Play builds still in use, and each OTA runtime they run), the website, a released CLI version on Homebrew, or the Siri intents: no Convex function or field they call is removed, renamed or tightened, and no new data shape renders wrong or blank on an old build. Where a break is unavoidable, the change carries a fallback that keeps the current version working (a compatibility shim, a field old builds already read), notes it under `## Summary`, and links a GitHub issue (`gh issue create`) that describes the fallback, who still depends on it, how to measure adoption, and the path to the new way alone, so the shim does not stay forever. "Users must update" is not a fallback. A migration, backfill or derived-data rebuild that writes prod documents still needs the user's go-ahead.
7. **Run live on every surface it touches.** Every changed path ran live against the dev deployment, on each surface the diff touches:
   - **iOS:** iPhone Duo folded, iPhone Duo unfolded, and one regular iPhone. Widgets and Siri intents on the simulator when the diff touches `targets/`, `widget/` or `plugins/ios-app-intents/`.
   - **Android:** a phone.
   - **Web:** the website in a browser.
   - **CLI:** the built CLI against dev.

   A surface the diff does not reach (an Android-only fix on iOS, a website-only change on the app) is not required. A surface that could not be run fails the gate; it is not a note in the test plan. Tooling-only changes pass.
8. **Confident above 85%.** With gates 1–7 passed, score from 0 to 100% how confident you are that this is the best work possible and has no bugs or issues, and name what keeps it from 100%. Score the risk list (step 6) honestly: every item on it lowers the score. Above 85% passes. At 85% or below, fix what lowers it and run the gates it reopens again.
