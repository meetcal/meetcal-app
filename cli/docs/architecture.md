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
  - `Body::Value`: the answer is the body (`results:search`, `reference:clubAthletes`,
    `reference:clubMeetStats`). Convex writes its numbers as floats; `backend.rs` turns whole
    numbers back into integers before parsing.
- A function that ran and failed answers `{ status: "error", errorMessage, errorData }` (HTTP 200
  or 560). Our functions throw `{ status, error }` as `errorData`; the CLI prints
  `MeetCal could not answer <query>: <error>`.
- `send_with_retry` applies `src/utils/retry.rs`: 429 and 503 are retried twice, honoring
  `Retry-After` (clamped to 1 to 30 seconds) or backing off 1 then 2 seconds. Once retries run
  out, a 429 explains how long to wait.
- One shared `reqwest` client with a 10-second connect timeout, a 30-second request timeout, and a
  `meetcal-cli/<version>` User-Agent.
- `MEETCAL_CONVEX_URL` (read at run time) points the CLI at another deployment.

The queries themselves are in `../convex/` (`reference.ts`, `meets.ts`, `results.ts`). Many are
served from materialized views; `../docs/backend.md` explains when a view needs rebuilding.

## Commands

| Group | Commands | Reads |
|---|---|---|
| Athletes | `search`, `wrapped`, `compare` | `results:byNames`, `results:search` |
| Meets | `meet`, `meet-results` | `meets:athletesSessions`, `results:byMeet` |
| Clubs | `club-results`, `club-wrapped`, `club-compare` | `reference:clubMeetStats`, `reference:clubAthletes`, `results:recent` |
| WSOs | `wso`, `wso-wrapped`, `wso-compare` | `meets:athletes`, `results:byNames`, `results:byMeet`, `reference:wsoAthletes`, `results:recent` |
| Reference | `records`, `standards`, `qualifying-totals`, `intl-rankings`, `nat-rankings`, `nat-ranking-year`, `wso-records`, `adaptive-records` | the matching `reference:*` query |

Reference commands fetch the whole table and filter it locally by the flags (`records --age --gender
--federation`), except where the query takes the filter itself (`wso-records`, `nat-rankings`,
`adaptive-records`).

### Club and WSO reports

`club-wrapped`, `club-compare`, `wso-wrapped` and `wso-compare` share `group_wrapped.rs`:

1. Read the group's registrations across meets (`reference:clubAthletes` or
   `reference:wsoAthletes`). A registration records the club and WSO the athlete entered under at
   that meet, so an athlete who changed WSOs counts for each at the right meets.
2. Read those athletes' results since a cutoff (`results:recent`, 50 names per call).
3. Keep only results from meets where the athlete registered with the group
   (`filter_membership_results`), then summarize by calendar year.

Registration events and results meets do not always share a name: USA Weightlifting publishes some
national events' start lists under one combined name and their results under the individual
championships. `src/utils/meet_names.rs` matches them (`equivalent_meets`) and lists the results
meets to read for a registration event (`result_meet_aliases`), deliberately narrowly so one
national event is never credited to another.

`wso` (one WSO at one meet) reads the meet's roster, the WSO athletes' previous results for PRs,
and the meet's results under each alias.

## Adding a command

1. A module in `src/commands/` with an `Args` struct (clap `Parser`, with doc comments; they are
   the help text) and `pub async fn run(args) -> Result<()>`.
2. The subcommand in `src/parser.rs` and its arm in `src/main.rs`.
3. Any new Convex query in `queries` (`src/utils/backend.rs`), with the answer type beside the
   command or in `src/types/`.
4. Tests: argument parsing in `tests/<command>.rs`, and the command's pure logic (stats,
   filtering) in the module's unit tests.
5. The command's section in `README.md`, and a `CHANGELOG.md` entry.
