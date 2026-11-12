# Architecture

`meetcal` is a tokio binary: `src/main.rs` parses the command with clap (`src/parser.rs`) and calls
that command's `run(args)` in `src/commands/`. Each command fetches from Convex, computes what it
reports, and prints `comfy-table` tables to stdout.

## Data: Convex over HTTP

Every read goes through `src/utils/backend.rs`, which posts to Convex's HTTP API:

```text
POST https://disciplined-hare-790.convex.cloud/api/query
{ "path": "reference:wsoRecords", "args": { "wso": "Carolina", "ageCategory": "Senior", "gender": "Men" }, "format": "json" }
```

- `queries` lists every Convex function the CLI reads, each with the Rust API route it replaced
  (the CLI read `api.meetcal.app` through 2.0.1). Commands call
  `query(queries::RECORDS, &NoArgs {})` or `query(queries::WSO_RECORDS, &args)`.
- An answer carries its body one of two ways, recorded on the `Query`:
  - `Body::JsonText`: `{ json }` or `{ etag, json }`, the body as JSON text. Most list answers come
    this way.
  - `Body::Value`: the answer is the body (`results:search`, `reference:clubMeetStats`). Convex
    writes its numbers as floats; `backend.rs` turns whole numbers back into integers before
    parsing.
- `reference:clubAthletes` and `reference:wsoAthletes` are paged: `query_all_pages` sends
  `cursor: null`, then each returned `cursor`, and concatenates each page's
  `{ json, cursor, isDone }` rows until `isDone`, failing after `MAX_PAGES`. Rows are not ordered
  or unique across pages.
- A function that ran and failed answers `{ status: "error", errorMessage, errorData }` (HTTP 200
  or 560). Our functions throw `{ status, error }` as `errorData`; the CLI prints
  `MeetCal could not answer <query>: <error>`.
- `src/utils/transport.rs` sends every request and applies `src/utils/retry.rs` to queries and
  premium actions. It asks for gzip, which Convex serves (answers are 8 to 22 times smaller). 429
  and 503 are retried twice, honoring `Retry-After` (clamped to 1 to 30 seconds) or backing off 1
  then 2 seconds; once retries run out, a 429 explains how long to wait. Network failures are
  `retry::Failure`s, each with its own budget and a message that says to check the connection:
  a connection that could not be made (DNS, refused, or no handshake within 8 seconds) is tried
  once more, then the deployment counts as unreachable for the rest of the run, so the pass fetch
  and the read after it fail together; a request dropped before its answer, an answer that stops
  arriving (20 seconds without a byte) or one cut short is sent again twice; a read with no answer
  within 60 seconds is not. Other actions and mutations are sent once (`Endpoint::retries`): one
  may have done its work before its answer was lost.
- The first request to a deployment goes alone: requests started beside it wait until it has an
  answer, then share its HTTP/2 connection instead of each opening one.
- `query_each` runs one query per argument set, at most `CONCURRENT_READS` (12) at a time, and
  returns the answers in the arguments' order (`in_order` is the bounded runner). The name batches
  of the club and WSO reports and the per-meet medal reads of the trends reports go through it.
- One shared `reqwest` client with an 8-second connect timeout, a five-minute cap on any request,
  and a `meetcal-cli/<version>` User-Agent. A premium action waits longer for its answer
  (`PremiumAction::answer_within`): two minutes for `results:leaderboard`, which reads a whole
  range before it answers, and for `results:wsoElite`, which reads every member's registrations
  and history.
- `MEETCAL_CONVEX_URL` (read at run time) points the CLI at another deployment.
- `call_function` runs any query, mutation or action (`Endpoint`) with an optional bearer token,
  for the few calls that are not data reads (`functions::*`, `queries::ACCESS_PASS`). A function
  error reaches callers as a `FunctionError` carrying its `errorData` status.

## Login and the access pass

Premium data (`PREMIUM_FUNCTIONS` in `src/utils/access.rs`, equal to `convex/lib/access.ts`'s list
and the website's `SUBSCRIPTION_FUNCTIONS`; `results:search` only with both dates) is read with a
shared daily access pass as the `pass` argument (`../docs/backend.md`, "Premium data"). So is the
premium actions `results:leaderboard` and `results:wsoElite` (`PREMIUM_ACTIONS`, equal to the
server's), through
`backend::premium_action`, which handles a refusal the same way.

- `meetcal login` (`src/commands/login.rs`) runs a device-code login (`convex/deviceLogin.ts`):
  `deviceLogin:start` (an action, with the device's name) answers a secret device code, a user code
  and the approval page; the CLI prints `<verificationUrl>?code=<userCode>`, the code, and a QR code
  of the link when stderr is a terminal, then polls `deviceLogin:poll` every `interval` seconds
  (five more after each `slow_down`) until it answers `approved` (with a 90-day MeetCal-issued
  token), `denied`, `expired` or `collected` (approved, but the answer carrying the token was
  lost: the user runs `login` again). A poll that fails is not resent; the loop polls again at the
  next interval, giving up after five failures in a row. The polling policy is `Poller` in `src/utils/device_login.rs`,
  free of I/O. Nothing is interactive, so it runs over SSH and for agents.
- The token is saved by `src/utils/credentials.rs` in
  `$XDG_CONFIG_HOME/meetcal/credentials.json` (else `~/.config/meetcal/`; `%APPDATA%` on Windows),
  0600 in a 0700 directory, as `{ token, tokenId, expiresAt, deployment }`. A login is used only
  on the deployment that issued it. Logging in again replaces it and revokes the old token
  (`apiTokens:revoke`, best effort); `meetcal logout` revokes and deletes it.
- `Access` (`src/utils/access.rs`) holds the run's pass. The first premium read takes the pass
  kept in the cache (below) while it belongs to the saved login and is not yet due, or else trades the saved token for one (`accessPass:pass`; only it,
  `entitlements:refresh` and `apiTokens:revoke` send the token) and keeps it; concurrent reads
  share that fetch. A pass is due at its `rotatesAt`, but is held at least five minutes from
  its fetch (`ACCESS_PASS_MIN_HOLD_MS`, as the app, the website and Siri hold it), so a clock
  running ahead or a late rotation does not turn every run into a pass fetch. A pass Convex refuses is fetched again, never taken from the cache. When it answers 403, the CLI asks `entitlements:refresh` (an
  action, with the token) to re-check the subscription with RevenueCat, and asks for the pass once
  more if that answers `{ active: true }`; `login` does the same for its subscription check.
  Numbers outside the data rows (`expiresAt`, `rotatesAt`, `interval`) are read with
  `backend::whole_number`, which takes `5` and `5.0` alike. The pass goes into each premium read's arguments; no data read
  carries the token, so premium answers stay in Convex's shared cache. Without a pass (not logged
  in, not subscribed, an expired login, a failed fetch) a premium read goes without one: Convex
  answers it while `PREMIUM_MODE` is `log`.
- A premium read Convex refuses (a function error with status 401 or 403) goes through
  `access::on_refusal`: with a pass that was refused, or a fetch that failed, the CLI fetches the
  pass again and reads once more; without a login, with an expired or rejected one, or without a
  subscription, it fails with a `PassRefused` error saying to run `meetcal login` or to subscribe.
  `meet` shows its start list without past-year bests in that case, since the start list is free.

## The answer cache

`src/utils/cache.rs` keeps answers between runs in `$XDG_CACHE_HOME/meetcal/` (else
`~/.cache/meetcal/`; `%LOCALAPPDATA%` on Windows), 0600 files in 0700 directories:

- The queries that take `ifNoneMatch` (`Body::Revalidated` in `queries`: the meet lists, details,
  schedules, rosters and start lists, a meet's results, and the reference tables) keep their `{ etag, json }` under `answers/`, one file
  per deployment, function and arguments (a SHA-256 of them, the pass and tag left out). The next
  read sends the kept tag; Convex answers `{ etag }` alone when the body is unchanged (72 bytes
  instead of 377 KB for `reference:records`), and the kept body is used. Nothing is served
  without asking. A test reads each function's `args` in `../convex/` and fails when a query
  marked revalidated takes no `ifNoneMatch`, or one that takes it is not marked.
- Premium answers go under `answers/premium/`, and only when the read carried a pass. A new pass
  (`pass.json`, with the login's token id, the deployment and when it is due) drops them, as do
  `logout`, a rejected login and a lapsed subscription.
- Writes go to a temporary file renamed into place; an unreadable file is a miss and is
  replaced. Past 64 MB the least recently used answers go, and one larger than 16 MB is not kept.

The queries themselves are in `../convex/` (`reference.ts`, `meets.ts`, `results.ts`). Many are
served from materialized views; `../docs/backend.md` explains when a view needs rebuilding.

## Upgrades

`meetcal upgrade` (`src/commands/upgrade.rs`) asks GitHub for the release list and takes the
highest `cli-vX.Y.Z` tag that is neither a draft nor a pre-release (`src/utils/releases.rs`;
releases are not marked the repository's latest, so GitHub's "latest" answer is not used). It
judges how it was installed by where its binary is, symlinks resolved (`src/utils/upgrade.rs`):

- under a Homebrew prefix's `Cellar/meetcal/`: it runs that prefix's `bin/brew update` (Homebrew
  refreshes taps at most once a day on its own, so `upgrade` alone can find nothing) and `brew
  upgrade meetcal/tap/meetcal`, so Homebrew's records stay right;
- in Cargo's `bin` (`$CARGO_HOME/bin`, else `~/.cargo/bin`): `cargo install --git … --tag
  cli-vX.Y.Z --locked --force meetcal`;
- either way it then runs the installed binary's `--version` and fails unless it is the release
  (a package manager that found nothing newer still exits 0);
- anywhere else: it downloads its platform's archive and `SHA256SUMS`, refuses an archive whose
  hash differs, writes the binary beside the old one, runs its `--version`, and renames it over
  the old one, so any failure leaves the installed binary as it was. A directory it cannot write
  ends with the `sudo` command to run; it never escalates itself. A platform with no release
  build (Windows) is told the `cargo install` command.

`upgrade --check` exits 0 when this is the newest, 1 when a newer release is out and 2 when it
cannot tell (offline, GitHub refused), so a script never reads a failure as an upgrade.

Every other command, when stderr is a terminal and neither `CI` nor `MEETCAL_NO_UPDATE_CHECK` is
set, starts `src/utils/update_notice.rs` beside its work: at most once a day it asks GitHub (5
seconds at most, and the command waits at most 300 ms for it after finishing), and at most once
a day it prints one line to stderr when a newer release is out. Both times and the newest version
are kept in `update-check.json` beside the saved login. `MEETCAL_RELEASES_URL` points both at
another release list (the tests' local server).

## Commands

| Group | Commands | Reads |
|---|---|---|
| Athletes | `search`, `progress`, `h2h` | `results:byNames`, `results:search` |
| Wrapped | `wrapped`, `compare` | `results:wrapped` (public: the server scores the year, `convex/lib/wrapped.ts`) |
| Standards | `qualify` | `results:byNames`, `results:bests`, `reference:standards`, `reference:qualifyingTotals` |
| Meets | `meets`, `meet-info`, `schedule`, `meet`, `meet-results` | `meets:list`, `meets:completed`, `meets:details`, `meets:schedule`, `meets:athletesSessions` with `results:bests`, `results:byMeet` with `results:meetSummaries` (each edition's headline numbers, summarized on the server, `convex/lib/meetSummary.ts`) |
| Attendance | `attendance` | `meets:namesMatching`, `meets:attendance` |
| Leaderboard | `leaderboard` | `results:leaderboard`, an action that ranks every athlete in the range on the server (`convex/lib/leaderboard.ts`, the rules `Filters`, `rank` and `stats.rs` hold here); with `--wso`/`--club`, the group's registrations and `results:recent`, ranked here |
| Names | `clubs`, `wsos` | `reference:clubs`, `reference:registrationWsos`, `reference:wsoList`, `reference:wsoAgeGroups` |
| Clubs | `club-results`, `club-wrapped`, `club-compare`, `club-trends` | `reference:clubMeetStats`, `reference:clubAthletes`, `results:recent`, `results:byNames`, `results:groupMedals` |
| WSOs | `wso`, `wso-wrapped`, `wso-compare`, `wso-trends` | `reference:wsoMeetStats`, `results:byNames`, `results:groupMedals`, `reference:wsoAthletes`, `results:recent` |
| WSO elite | `elite` | `reference:registrationWsos`, then `results:wsoElite`, an action that finds the WSO's members and ranks each list on the server (`convex/lib/elite.ts`) |
| Reference | `records`, `standards`, `qualifying-totals`, `intl-rankings`, `nat-rankings`, `nat-ranking-year`, `wso-records`, `adaptive-records` | the matching `reference:*` query |
| Login | `login`, `logout` | `deviceLogin:start`, `deviceLogin:poll` (actions), `accessPass:pass`, `apiTokens:revoke` (mutation) |
| Upgrade | `upgrade` | GitHub, not Convex: the release list (`api.github.com/repos/meetcal/meetcal-app/releases`) and the newest `cli-v*` release's archive and `SHA256SUMS` |

`records` and `qualifying-totals` send their flags to the query (`federation`, `ageCategory`,
`gender`; `event`), which answers the one table. When it answers none, `reference:recordCategories`
or `reference:qualifyingTotalCategories` (every federation, gender and age group; every event,
gender and age group) names the values to try. `wso-records`, `nat-rankings` and
`adaptive-records` take their filters the same way; `standards` and `intl-rankings` read the whole
table and filter it here.

### Club and WSO reports

`club-wrapped`, `club-compare`, `wso-wrapped` and `wso-compare` share `group_wrapped.rs`:

1. Read the group's registrations across meets (`reference:clubAthletes` or
   `reference:wsoAthletes`, a page at a time). A registration records the club and WSO the athlete entered under at
   that meet, so an athlete who changed WSOs counts for each at the right meets.
2. Read those athletes' results since a cutoff (`results:recent`, 50 names per call).
3. Keep only results from meets where the athlete registered with the group
   (`filter_membership_results`), then summarize by calendar year (`calculate_wrapped_stats`).
   This scoring is local because the group's rows are premium data; an athlete's own Wrapped
   (`wrapped`, `compare`) is the server's `results:wrapped` answer, scored with the app's rules.

Registration events and results meets do not always share a name: USA Weightlifting publishes some
national events' start lists under one combined name and their results under the individual
championships. `src/utils/meet_names.rs` matches them (`equivalent_meets`) and lists the results
meets to read for a registration event (`result_meet_aliases`), deliberately narrowly so one
national event is never credited to another.

`wso` (one WSO at one meet) prints the server's `reference:wsoMeetStats` answer through the same
report as `club-results` (`club_results::report`); it computes nothing itself. `club-trends` and
`wso-trends` ask `results:groupMedals` for each meet the group lifted at (every spelling of its
name, and the members registered there, 2,000 a call): the server places the meet's results
(`convex/lib/placings.ts`) and answers the members' medals by year.

### Names and suggestions

Meet, club and WSO names are exact. When a command finds nothing for one, `src/utils/names.rs`
fetches the names MeetCal knows and suggests the closest: names containing the input first, then
names matching most of its words, a word matching when it is the same, a prefix, or a typo or two
away. If the input is exactly a known name (the meet exists but has no results yet), no suggestions
are shown; a name differing from it only in case or punctuation is suggested alone.

The candidates depend on what the command reads (`NameKind`):

- Tracked meets (`meet`, `meet-info`, `schedule`, `wso`): `meets:list` and `meets:completed`.
- Results meets (`meet-results`, `club-results`): those, plus the results meets whose names start
  with the input's first word (`meets:namesPage` over that name range): there are over 7,000, too
  many to list on every typo.
- Clubs: `reference:clubs`.
- WSOs in the club and WSO reports: `reference:registrationWsos`, the names on registrations.
  Record sheets name some WSOs differently ("California North" keeps records, "California North
  Central" registers athletes), so `wso-records` suggests from `reference:wsoList` instead.
  `meetcal wsos` lists both.

### Past-year bests

`meet` shows each athlete's best snatch, clean & jerk and total since the same UTC date a year
earlier, as the app's start list does (`src/utils/bests.rs`, `results:bests`, 100 names per call).

### Output

Commands print through `src/utils/output.rs`: they build a `Report` of named tables (with an
optional title, headings, and a message for when there are no rows) and call `output::emit`. The
global `--format` flag picks tables, JSON or CSV. A table whose display packs several values into
one cell (a record's holder under its weight) carries a flat `data` table for the machine formats.
Keep `println!` out of commands, or `--format` stops working for them.

### Statistics

`src/utils/stats.rs` holds what the analysis commands share: parsing a division (`Open Men's
89kg`, `Women's Masters (40-44) 69kg`) into gender, age category and class; Sinclair (the IWF's
2021–2024 coefficients, in `SINCLAIR_MEN` / `SINCLAIR_WOMEN`: change them there when a newer set is
confirmed); Q-points (the authors' published formula, `QPOINTS_MEN` / `QPOINTS_WOMEN`, with its
50/41 kg bodyweight floor; not computed for youth divisions, which the formula does not cover);
attempt habits; bomb-outs; and PR detection over an athlete's history in date order.
Two guards cover source errors: Sinclair and Q-points need a bodyweight of 15–250 kg, and a result whose total
is not its snatch plus clean & jerk is left out of Sinclair and leaderboards.

### The leaderboard, and every meet name

The CLI does not read every result in a range: `leaderboard` asks `results:leaderboard`, an action
that pages through the range on the server (a month at a time, 2,000 rows per internal query) and
answers only the ranked rows and the range's federations (for the unknown-federation message). Its
rules are a port of `Filters::keeps`, `rank` and `stats.rs` (`convex/lib/leaderboard.ts`), which
still rank `--wso` and `--club` leaderboards here; change both together. `meets:namesPage` lists distinct meet
names in the results or the registrations by skipping along the meet index, one read per meet.
`attendance` asks `meets:namesMatching` for the names holding every word (the server folds names
and words, `convex/lib/meetNameMatch.ts`), then counts each matched edition with
`meets:attendance` (eight meets per call; a batch the server refuses as too many rows for one
call, status 413, is asked for again as two halves, and one meet refused alone is an error).

## Adding a command

1. A module in `src/commands/` with an `Args` struct (clap `Parser`, with doc comments; they are
   the help text) and `pub async fn run(args) -> Result<()>`.
2. The subcommand in `src/parser.rs` and its arm in `src/main.rs`.
3. Any new Convex query in `queries` (`src/utils/backend.rs`), with the answer type beside the
   command or in `src/types/`.
4. Output through `output::emit(Report::…)`, never `println!`, so `--format` works.
5. Tests: argument parsing in `tests/<command>.rs`, and the command's pure logic (stats,
   filtering) in the module's unit tests.
6. The command's section in `README.md`, and a `CHANGELOG.md` entry.
