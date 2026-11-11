---
name: merge-and-deploy
description: Merge MeetCal pull requests and deploy Convex to production safely: one integration tree, a prod function-spec diff, one deploy, then merges in order. Use when your pull request passes every merge gate in the finish-work skill, or when the user asks in the current task to merge and deploy.
---

# Merge And Deploy

Merge only a pull request that passes every [merge gate](../finish-work/SKILL.md#merge-gates) (your own), a documentation-only one (no gates but green GitHub checks, no deploy), or one the user asked in the current task to merge. Deploy Convex to production only when what is being merged changes what Convex runs (anything under `convex/`, scrapers included), or when the user asks. A single pull request is a batch of one: its branch is the integration tree. Deploy once from a tree that contains every pull request being merged, so one pull request's deploy never drops another's functions, and merge right after the deploy, so the website's Vercel deploy and the next OTA never call a function prod lacks.

This skill deploys Convex code only. It never publishes an OTA update, submits a store build, releases the CLI, or writes production documents: a migration, backfill or derived-data rebuild (`docs/backend.md`) needs the user's explicit go-ahead with the payload shown first.

## 1. Build The Integration Tree

In a detached worktree off `origin/master`, merge each pull request's branch in the order it will land. Resolve each conflict once, keeping both sides where both are needed, and note the resolution: each branch will repeat it when rebased. The step is done when the tree has every branch and no conflict markers.

## 2. Check It

Run `mise run check` on the integration tree, plus the checks for every file a conflict touched. A failure that also fails on a clean `origin/master` is not the batch's: fix it in its own pull request that lands first.

## 3. Diff Against Prod

Push the tree to the dev deployment, then compare what prod runs with it. Every command reads an env file holding only `CONVEX_DEPLOYMENT=dev:utmost-retriever-826`, never the repository's `.env*` files (the main checkout's `.env` points at another project's deployment):

```bash
bunx convex dev --once --env-file <env> --typecheck disable --codegen disable
bunx convex function-spec --env-file <env> > after.json
bunx convex function-spec --prod --env-file <env> > before.json
bun .codex/skills/merge-and-deploy/scripts/function-spec-diff.ts before.json after.json
```

Deploy only when:

- **Removed** is empty. A function only prod has usually means another session deployed an unmerged branch; merge that branch into the tree, or ask the user, before deploying over it.
- Every **Changed** entry only loosens: `args` gain optional fields, `returns` gain fields (shipped apps, the website and released CLIs ignore extra fields), nothing a shipped app, the Siri intents or a released CLI calls is renamed or tightened.
- No schema change needs a backfill or migration that writes documents; those need the user's explicit go-ahead.
- The push printed no `[-]` index line you cannot explain.

## 4. Deploy Once

`bunx convex deploy --yes --env-file <env> --typecheck disable` from the integration tree deploys the project's production deployment (`disciplined-hare-790`). It is done when it prints `Deployed Convex functions` and `function-spec --prod` lists the new functions.

## 5. Merge In Order

For each pull request: rebase onto `origin/master`, repeat the conflict resolution from step 1, confirm with `git diff --stat <branch> <integration tree>` that the branch matches the deployed tree outside the files of pull requests still to land, check `entire status` (finish-work, step 4), `git push --force-with-lease`, wait for `gh pr checks <number>` to go green, then `gh pr merge <number> --squash`. A conflict-free rebase that touches none of the branch's files needs no new checks.

## 6. Confirm

- `git diff origin/master <integration tree> -- convex` is empty, so prod runs master's backend.
- The merge commits' `Vercel` statuses reach `success` (`gh api repos/meetcal/meetcal-app/commits/<sha>/statuses`).
- Push `origin/master` back to dev from a clean detached worktree, and remove the integration and branch worktrees.

Report what was deployed (added and changed functions), the merge commits, and anything a shipped app, the website or a released CLI will see differently.
