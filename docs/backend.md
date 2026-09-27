# Convex backend

The backend lives in `convex/`. Deployments:

| | Deployment | Used by |
|---|---|---|
| Dev | `utmost-retriever-826` | `npx convex dev`, `development*` EAS builds |
| Prod | `disciplined-hare-790` | `preview` and `production*` EAS builds, iOS App Intents |

## How data changes

Every write to competition data goes through the internal mutations in `convex/ingest.ts`. The scrapers (`convex/scrapers/`, scheduled by `convex/cronJobs.ts`) and `scripts/usamw-results.ts` all use them. Each ingest write:

1. writes the rows;
2. rewrites the touched athletes' **history** (`athlete_history`) and **summary** (`athlete_summary`) documents in the same transaction, so those can never lag behind `lifting_results`;
3. bumps the table's version and leaves **hints** naming what changed, then schedules a refresh.

A few seconds later `views:refresh` uses the hints to rebuild only what those rows feed:

- the materialized views (meet packages, rankings, reference tables, clubs, WSO records);
- the search **directory** and its two-letter **shards**, adding names that gained results and removing names left with none.

So new athletes, new results, deletions and new meets update everything on their own. Nothing needs to be run by hand.

## Writes that skip the ingest mutations

Anything that changes data another way leaves no hints and rewrites no histories or summaries. That includes:

- editing or deleting rows in the Convex dashboard;
- `npx convex import`, such as a bulk load from Postgres;
- a one-off `internalMutation` that patches source tables directly.

After one of those, bring the derived data back in step (add `--prod` for production):

```sh
npx convex run migrations:backfillNameKeys    # fills lifting_results.nameKey, then starts views:rebuildAll
npx convex run migrations:backfillSummaries   # fills athlete_summary from the history documents
```

`views:rebuildAll` rebuilds the histories, views, search directory and shards in stages; it runs on its own after `backfillNameKeys`, or can be started directly. While it runs, a refresh checks on it every minute and starts it again if a stage stopped for 15 minutes. To rebuild only the search shards from the current directory, run `npx convex run views:buildSearchShards`.

Check the result with `npx convex run parity:run`. It compares every fast path (views, histories, summaries, search shards) with a live computation from the raw tables and should report 0 mismatches. `migrations:countPage` counts a table a page at a time, for checking a load against its source.

## Scheduled jobs and alerts

`convex/cronJobs.ts` lists every job and its UTC schedule. Each run goes through `cronJobs:run`, which records it in `cron_status`. It emails `ALERT_EMAIL` (through OneSignal) when a job fails and again when it recovers. The hourly `cron-watchdog` emails when a job misses its run or never finishes. `urlwatch` emails page changes to `URLWATCH_EMAIL`. Set both variables on prod only.
