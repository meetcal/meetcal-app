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

What the writers match on:

- A result is identified within its event by meet, folded name (`normalizeName`: Unicode NFC, whitespace collapsed, lowercased) and age category (`ingest.resultKey`). The upsert, `deleteLiftingResults` and the Sport80 prune all use that key, and the upsert deletes a second stored copy of a row it updates.
- A meet is identified by its name, everywhere (rosters, results, schedules, views, saved sessions), and a stored name never changes. The meet syncs match a meet on name and federation. A new meet whose name another meet already has (usually another federation's) is stored as `<name> (<federation>)` (or `<name> (<federation> 2)` and on if a meet holds that too), with the source's name in `sourceName`, never over the other meet, and its sync (`meet-sync`, `usamw-events`) fails once so the alert names it: results and entries sent under the plain name still attach to the other meet until a person renames one. `npx convex run migrations:duplicateMeetNames` lists names held by more than one meet row (readers use the oldest).
- A meet's status follows its dates on its own calendar: `upcoming`, `ongoing` from its first day, `completed` after its last. The meet syncs set it on every write, and the hourly `complete-ended-meets` job (`ingest.updateMeetStatuses`) moves it as the days pass, including back to `upcoming` when a completed meet's dates move into the future.
- Genders are stored as `Men` / `Women` (`normalizeGender`). The athlete answers (start lists, rosters, club and WSO registrations) give `Male` / `Female`, the spelling the apps filter on.

The club-list builder reads at most 100 distinct club names per query and publishes the completed list in one mutation. It keeps the source version from its first page, so a roster write during the scan leaves the view stale for another refresh rather than marking mixed data fresh.

National ranking builders and their live parity checks read at most 1,000 results per query, merging each athlete's best total across pages. Builders publish only the complete ranking and keep the first page's source version for the same freshness guarantee.

## Writes that skip the ingest mutations

Anything that changes data another way leaves no hints and rewrites no histories or summaries. That includes:

- editing or deleting rows in the Convex dashboard;
- `npx convex import`, such as a bulk load from Postgres;
- a one-off `internalMutation` that patches source tables directly.

After one of those, bring the derived data back in step (add `--prod` for production):

```sh
npx convex run migrations:backfillNameKeys    # fills lifting_results.nameKey, then starts views:rebuildAll
```

`backfillNameKeys` also rekeys every row after a change to `normalizeName`. `views:rebuildAll` rebuilds the histories and their summaries, views, search directory and shards in stages; it runs on its own after `backfillNameKeys`, or can be started directly. It also deletes the history and summary documents of names left with no results, and clears every pending change written before it started. While it runs, a refresh checks on it every minute and starts it again if a stage stopped for 15 minutes. To rebuild only the search shards from the current directory, run `npx convex run views:buildSearchShards`.

A view is fresh while its source tables are unchanged, whatever the code that built it. So a deploy that changes what a view holds (a field added to `/data/records`, say) serves the old answer until the view is rebuilt: rebuild the views built by the function you changed, such as `npx convex run views:buildReferenceTables` (records, standards, qualifying totals, international rankings, adaptive records) or `npx convex run views:buildWso` (WSO records), or start `views:rebuildAll`.

Check the result with `npx convex run parity:run`. It compares every fast path (views, histories, summaries, search shards) with a live computation from the raw tables and should report 0 mismatches. `migrations:countPage` counts a table a page at a time, for checking a load against its source.

## Scheduled jobs and alerts

`convex/cronJobs.ts` lists every job and its UTC schedule. Each run goes through `cronJobs:run`, which records it in `cron_status`. It emails `ALERT_EMAIL` (through OneSignal) when a job fails and again when it recovers. The hourly `cron-watchdog` emails when a job misses its run or never finishes. The hourly `views-refresh` job runs a refresh even when none is scheduled, so views catch up after a refresh that failed or was lost. It fails, and so emails, when a write has waited over two hours for its views, or when the full rebuild keeps stopping. `urlwatch` emails page changes to `URLWATCH_EMAIL`. Set both variables on prod only.

A job that reads many sources (a WSO each in `wso-records`, a meet each in `results-sport80`, a target each in `entries`, a search, tab or PDF each in `meet-sync`, `umwf-records` and `intl-rankings`) stores what it could read, then fails naming the sources that failed (`sourcesFailed` in `convex/lib/cronAlerts.ts`). `cron_status.failedSources` keeps that list, and a source that starts failing while the job is already failing emails again, so a second outage is not hidden behind the first.

The watchdog's own runs are recorded in `cron_status` under `cron-watchdog`, and every job's run checks that it ran: one that misses its run or never finishes is emailed like any job. After a run that checked every job and sent every alert, the watchdog GETs `HEARTBEAT_URL`, a dead man's switch such as a [Healthchecks.io](https://healthchecks.io) check with an hourly period. The monitor alerts on its own when the pings stop, which catches what no email from the backend can: the crons stopped, the watchdog keeps failing, or OneSignal email broke. Unset (the dev deployment), nothing is pinged. Set it on prod only:

```sh
npx convex env set HEARTBEAT_URL https://hc-ping.com/<uuid> --prod
```

### When a sync refuses to delete

The syncs that delete what a source no longer lists refuse to delete more than a share of it at once, because a source that partly broke looks the same as data that went away. The run fails and the email says which limit was hit and the command to run once you have checked the source by hand:

- `wso-records` refuses to delete more than a quarter of a WSO's classes (at least 20 always allowed), or to clear as many of its stored lifts (a cell the parser could not read now fails the WSO instead of clearing the record). Override: `npx convex run scrapers/wsoRecords:run '{"only":["<WSO>"],"allowShrink":true}'`.
- `results-sport80` deletes an event's stored results its Sport80 table no longer has (a corrected name, a withdrawn result, the meet's old title), only for a meet whose every row was read and whose table has the rows its `total` reports with no row repeated across pages (a table reporting no `total`, or repeating a row, is stored but not pruned, and fails the run), and refuses to drop more than a tenth of an event's athletes (at least 5 always allowed; rows only retitled do not count). It also refuses to empty a column (a lift, the total, the body weight) on over half of the stored results it updates, which is what a column Sport80 renamed looks like. Override: `npx convex run scrapers/sport80:run '{"only":["<event id>"],"allowShrink":true}'`. A meet with over a fifth of its rows unreadable fails the run.
- `records`, `umwf-records` and `usamw-national-records` (`ingest.upsertRecords`) refuse to clear more than a quarter of the matched records' stored lifts (at least 20 always allowed). Override: `npx convex run scrapers/umwf:run '{"allowShrink":true}'` (or `scrapers/records:run`, `scrapers/usamw:run`).
- `intl-rankings` refuses to prune more than a quarter of the stored groups (at least 2 always allowed). Override: `npx convex run scrapers/intlRankings:run '{"allowShrink":true}'`.

Add `--prod` for production. The `entries` job skips a target whose meet is completed before downloading its list, and removes the target 14 days after the meet ended. Once any athlete of a meet has a session (its start list is published), it adds no new athletes to that meet, only updates the ones there.
