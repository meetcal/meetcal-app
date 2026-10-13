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
3. leaves **hints** naming what changed (a meet, a ranking class, an athlete, a reference table), then schedules a refresh.

Freshness is tracked per view: while a hint a view depends on is pending, that view is not served as fresh, and every other view is. A few seconds later `views:refresh` uses the hints to rebuild only what those rows feed:

- the materialized views (meet packages, rankings, reference tables, clubs, WSO records);
- the search **directory** and its two-letter **shards**, adding names that gained results and removing names left with none.

So new athletes, new results, deletions and new meets update everything on their own. Nothing needs to be run by hand.

The refresh deletes each group's hints as soon as its builds succeed. A build that throws (a malformed row, a meet past a read limit) is logged and keeps its hints, so only the views it names stay stale and the next refresh retries it; the hourly `views-refresh` job fails, and so alerts, while one does. A refresh stops after three minutes and queues another for what is left. Athlete hints carry the earliest result date they changed, so a meet's club stats (which depend only on earlier results) are rebuilt only when that date comes before the meet; its year-best timelines always are. The meets a refresh checks rosters of come from a maintained meet index (`index|meets`), not a scan of the tables.

What the writers match on:

- A result is identified within its event by meet, folded name (`normalizeName`: Unicode NFC, whitespace collapsed, lowercased) and age category (`ingest.resultKey`). The upsert, `deleteLiftingResults` and the Sport80 prune all use that key, and the upsert deletes a second stored copy of a row it updates. The pre-Convex import stored some meets' editions under one event id, so the key can also name another year's real result: the upsert matches only stored rows dated within 180 days of the incoming row (`ingest.SAME_EDITION_DAYS`; a copy stored under a wrong date stays a duplicate rather than risk deleting another edition's result), and the prune judges only rows dated within that window of the payload's (`ingest.sameEditionRows`, `sameEditionDates`). `deleteLiftingResults` deletes the key in every year.
- `npx convex run migrations:dedupeLiftingResults` deletes rows stored twice under one key: one edition (dated within 180 days), same body weight, attempts, total, federation and adaptive flag, keeping the newest and its pre-Convex serial. Rows under a key that differ (another edition, or two sets of values) are logged as `dedupeLiftingResults: left …` for a person, never deleted. Run it with `'{"dryRun":true}'` first and read the logs. It deletes through the ingest path, so histories, summaries, views and search follow on their own.
- A meet is identified by its name, everywhere (rosters, results, schedules, views, saved sessions), and a stored name never changes. The meet syncs match a meet on name and federation. A new meet whose name another meet already has (usually another federation's) is stored as `<name> (<federation>)` (or `<name> (<federation> 2)` and on if a meet holds that too), with the source's name in `sourceName`, never over the other meet, and its sync (`meet-sync`, `usamw-events`) fails once so the alert names it: results and entries sent under the plain name still attach to the other meet until a person renames one. `npx convex run migrations:duplicateMeetNames` lists names held by more than one meet row (readers use the oldest).
- A meet's status follows its dates on its own calendar: `upcoming`, `ongoing` from its first day, `completed` after its last. The meet syncs set it on every write, and the hourly `complete-ended-meets` job (`ingest.updateMeetStatuses`) moves it as the days pass, including back to `upcoming` when a completed meet's dates move into the future. A meet with a blank or unreadable zone is read on the calendar of UTC-12, the last place a day begins and ends, so it never turns `ongoing` or `completed` before its first day has begun, or its last has ended, everywhere.
- Genders are stored as `Men` / `Women` (`normalizeGender`). The athlete answers (start lists, rosters, club and WSO registrations) give `Male` / `Female`, the spelling the apps filter on.

The club-list builder reads at most 100 distinct club names per query and publishes the completed list in one mutation. A roster write during the scan renews the club hint, so the view stays stale for another refresh rather than marking mixed data fresh.

National ranking builders and their live parity checks read at most 1,000 results per query, merging each athlete's best total across pages. Builders publish only the complete ranking, with the same freshness guarantee.

National rankings and the club list are served from their last build even while a change to them is pending: computing them live is more than one query may read. A ranking class or club list with no view yet is answered live only when it fits one page, and otherwise fails with "being built" until the refresh builds it.

## Writes that skip the ingest mutations

Anything that changes data another way leaves no hints and rewrites no histories or summaries. That includes:

- editing or deleting rows in the Convex dashboard;
- `npx convex import`, such as a bulk load from Postgres;
- a one-off `internalMutation` that patches source tables directly.

After one of those, bring the derived data back in step (add `--prod` for production):

```sh
npx convex run migrations:backfillNameKeys    # fills lifting_results.nameKey, then starts views:rebuildAll
```

`backfillNameKeys` also rekeys every row after a change to `normalizeName`. `views:rebuildAll` rebuilds the histories and their summaries, views, search directory and shards in stages; it runs on its own after `backfillNameKeys`, or can be started directly. It also deletes the history and summary documents of names left with no results, deletes every view it did not rebuild and no later write names (a deleted meet, ranking class or WSO, an old adaptive season), and clears every pending change written before it started. A build that fails is logged and left pending for a targeted refresh instead of stopping the rebuild (or starting another), and the hourly `views-refresh` job alerts until a refresh builds it. While it runs, a refresh checks on it every minute and, if a stage stopped for 15 minutes, resumes it where that stage started. To rebuild only the search shards from the current directory, run `npx convex run views:buildSearchShards`.

A view is fresh while no change it reads is pending, whatever the code that built it. So a deploy that changes what a view holds (a field added to `/data/records`, say) serves the old answer until the view is rebuilt: rebuild the views built by the function you changed, such as `npx convex run views:buildReferenceTables` (records, standards, qualifying totals, international rankings, adaptive records) or `npx convex run views:buildWso` (WSO records), or start `views:rebuildAll`.

Check the result with `npx convex run parity:run`. It compares every fast path (views, histories, summaries, search shards) with a live computation from the raw tables and should report 0 mismatches. `migrations:countPage` counts a table a page at a time, for checking a load against its source.

## Saved sessions

Saved sessions (`convex/users.ts`) are user data, not competition data: they feed no view, history, summary or search shard, so a write to them needs nothing rebuilt. The app's outbox sends each write with its install id and revision (`device`, `rev`), and the server ignores a write that arrives after a newer one from the same install, such as a save that lands after the client timed out and then unsaved. It remembers the last revision each install applied to a session (`saved_session_revisions`, kept after a delete as the session's tombstone) and to a reset of a meet or of everything (`saved_session_resets`). A write from another install, or from an app too old to send a revision, applies as it arrives. Each ordered write deletes up to 32 of the user's records older than 7 days from each table; they only have to outlive a delayed request.

When a user deletes their account in Clerk, Clerk's `user.deleted` webhook (`POST /clerk/webhook` on the deployment's `.convex.site` host, Svix-signed with `CLERK_WEBHOOK_SECRET`) runs `users:deleteUserData`, which deletes their saved sessions, preferences and write-order records and keeps only their id in `deleted_users`, so a request still carrying a valid token for the account is refused (403) rather than storing its data again.

## Meet time zones and dates

The meet scrapers take a meet's time zone from its state, or its city in a state that spans two zones (`convex/scrapers/lib/states.ts`). A meet abroad, or in a US territory, takes the zone of its country when the country keeps one clock (`convex/scrapers/lib/countries.ts`; Spain, Portugal, New Zealand and Ecuador except their outlying islands). A meet in a country with several zones (Canada, Mexico, Australia, Brazil, ...), or a state or country they do not know, keeps the zone it has, or gets a blank one if new, and the run reports it. To set a zone by hand, use `npx convex run ingest:setMeetTimeZone '{"name":"…","timeZone":"America/Vancouver"}'`. It accepts any IANA zone, spelled as the tz database spells it (`isMeetTimeZone` in `convex/lib/validation.ts`), and refuses abbreviations ("EST"), offsets ("+09:00") and other casings, which some clients cannot read. Session times are meet-local wall-clock times everywhere: the app labels them with the zone at the meet ("EDT" in the US, "GMT+9" where the zone has no lettered name) and converts them in that zone for reminders, calendar events and the next-session card; the website and CLI print the zone's name. This locks the zone so the nightly syncs leave it alone. Pass `"locked":false` to hand it back to them. A meet with a blank zone is completed once its last day has ended everywhere on Earth (UTC-12). `npx convex run scrapers/queries:meetDataProblems` lists blank zones and names that are not IANA zones, zones the state, city or country now place elsewhere, and dates that are not padded `YYYY-MM-DD`. `npx convex run migrations:padMeetDates` pads the unpadded dates.

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
