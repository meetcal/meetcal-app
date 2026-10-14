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
- `send_with_retry` applies `src/utils/retry.rs` to queries and premium actions: 429 and 503 are
  retried twice, honoring `Retry-After` (clamped to 1 to 30 seconds) or backing off 1 then 2
  seconds. Once retries run out, a 429 explains how long to wait. Other actions and mutations are
  sent once (`Endpoint::retries`): one may have done its work before its answer was lost.
- One shared `reqwest` client with a 10-second connect timeout, a 30-second request timeout, and a
  `meetcal-cli/<version>` User-Agent. A premium action carries its own timeout (`PremiumAction`):
  two minutes for `results:leaderboard`, which reads a whole range before it answers.
- `MEETCAL_CONVEX_URL` (read at run time) points the CLI at another deployment.
- `call_function` runs any query, mutation or action (`Endpoint`) with an optional bearer token,
  for the few calls that are not data reads (`functions::*`, `queries::ACCESS_PASS`). A function
  error reaches callers as a `FunctionError` carrying its `errorData` status.

## Login and the access pass

Premium data (`PREMIUM_FUNCTIONS` in `src/utils/access.rs`, equal to `convex/lib/access.ts`'s list
and the website's `SUBSCRIPTION_FUNCTIONS`; `results:search` only with both dates) is read with a
shared daily access pass as the `pass` argument (`../docs/backend.md`, "Premium data"). So is the
premium action `results:leaderboard` (`PREMIUM_ACTIONS`, equal to the server's), through
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
- `Access` (`src/utils/access.rs`) holds the run's pass. The first premium read trades the saved
  token for it (`accessPass:pass`; only it, `entitlements:refresh` and `apiTokens:revoke` send the token);
  concurrent reads share that fetch. When it answers 403, the CLI asks `entitlements:refresh` (an
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

The queries themselves are in `../convex/` (`reference.ts`, `meets.ts`, `results.ts`). Many are
served from materialized views; `../docs/backend.md` explains when a view needs rebuilding.

## Commands

| Group | Commands | Reads |
|---|---|---|
| Athletes | `search`, `progress`, `h2h` | `results:byNames`, `results:search` |
| Wrapped | `wrapped`, `compare` | `results:wrapped` (public: the server scores the year, `convex/lib/wrapped.ts`) |
| Standards | `qualify` | `results:byNames`, `results:bests`, `reference:standards`, `reference:qualifyingTotals` |
| Meets | `meets`, `meet-info`, `schedule`, `meet`, `meet-results` | `meets:list`, `meets:completed`, `meets:details`, `meets:schedule`, `meets:athletesSessions` with `results:bests`, `results:byMeet` |
| Attendance | `attendance` | `meets:namesPage`, `meets:attendance` |
| Leaderboard | `leaderboard` | `results:leaderboard`, an action that ranks every athlete in the range on the server (`convex/lib/leaderboard.ts`, the rules `Filters`, `rank` and `stats.rs` hold here); with `--wso`/`--club`, the group's registrations and `results:recent`, ranked here |
| Names | `clubs`, `wsos` | `reference:clubs`, `reference:registrationWsos`, `reference:wsoList`, `reference:wsoAgeGroups` |
| Clubs | `club-results`, `club-wrapped`, `club-compare`, `club-trends` | `reference:clubMeetStats`, `reference:clubAthletes`, `results:recent`, `results:byNames`, `results:byMeet` |
| WSOs | `wso`, `wso-wrapped`, `wso-compare`, `wso-trends` | `meets:athletes`, `results:byNames`, `results:byMeet`, `reference:wsoAthletes`, `results:recent` |
| Reference | `records`, `standards`, `qualifying-totals`, `intl-rankings`, `nat-rankings`, `nat-ranking-year`, `wso-records`, `adaptive-records` | the matching `reference:*` query |
| Login | `login`, `logout` | `deviceLogin:start`, `deviceLogin:poll` (actions), `accessPass:pass`, `apiTokens:revoke` (mutation) |

Reference commands fetch the whole table and filter it locally by the flags (`records --age --gender
--federation`), except where the query takes the filter itself (`wso-records`, `nat-rankings`,
`adaptive-records`).

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

`wso` (one WSO at one meet) reads the meet's roster, the WSO athletes' previous results for PRs,
and the meet's results under each alias.

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
names in the results or the registrations by skipping along the meet index, one read per meet;
`attendance` lists 44 name ranges at once (`RANGE_BOUNDARIES`), about four seconds for the whole
history, then counts each matched edition with `meets:attendance` (eight meets per call). The
ranges only balance the work: they cover every name whatever the data holds.

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
