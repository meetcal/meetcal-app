# MeetCal CLI

`meetcal`, a Rust command line tool for MeetCal's competition data: athlete search and Wrapped reports, meet start lists and results, club and WSO reports, rankings, records, standards and qualifying totals. It reads the Convex queries in `../convex/`, the same ones the app and meetcal.app read, over Convex's HTTP API (`src/utils/backend.rs`), and prints tables. Users install it through Homebrew (`brew install meetcal/tap/meetcal`).

The repository root's `AGENTS.md` applies here too: its hard rules (worktrees, no production deploys or data writes without authorization, never push to `master`) and its PR workflow. This file adds what is specific to the CLI and names where it differs.

## Differences from the root

- The toolchain is Cargo and mise (`mise.toml` in this folder), not Bun. The root's `mise run check` runs this folder's `cargo fmt --check`, clippy and tests (as CI does) when the branch changes `cli/`, one worktree at a time; [Verify](#verify) lists the rest.
- `mise.toml` pins Rust (CI and the release workflow use the same release) and runs Cargo through mr boxington (mbx, https://mr-boxington.jdx.dev), which caches build output across worktrees: run Cargo through mise (`mise exec -- cargo …`, `mise run …`), which needs mise 2026.9.2 or later. `target/` is a symlink into mbx's store (`mbx clean` removes it); `MBX_DISABLE=1` runs plain Cargo for one command. Change the Rust version in this file, `../web/mise.toml`, the workflows and `../web/scripts/vercel-build.sh` together.
- Publishing a release (a `cli-v*` tag) is an external action, and it also updates the Homebrew tap: do it only when the task asks for a release. [docs/releasing.md](docs/releasing.md) has the steps.
- A change to a Convex query in `../convex/` can change what a command prints. The CLI CI runs on changes to `convex/` for that reason; when you change a query's answer, check the commands that read it (`src/commands/`).

## Layout

| Path | Role |
|---|---|
| `src/main.rs`, `src/parser.rs` | Entry point and the clap command set; `parser.rs` holds every subcommand's arguments and help |
| `src/commands/` | One module per command (`run(args)`); shared report logic in `group_wrapped.rs` (club and WSO years) and `compare.rs` |
| `src/utils/backend.rs` | The only data access: every Convex query the CLI reads (`queries::*`), the premium leaderboard action and the login's actions and mutation (`functions::*`), and the HTTP call |
| `src/utils/access.rs` | The access pass premium reads carry: `PREMIUM_FUNCTIONS` and `PREMIUM_ACTIONS` (equal to `convex/lib/access.ts`'s lists), fetching the pass with the saved login, and what a refused read does |
| `src/utils/credentials.rs`, `device_login.rs` | The saved login (`~/.config/meetcal/credentials.json`, 0600), and the device-code login's answers, polling policy and QR code; `src/commands/login.rs` runs `login` and `logout` |
| `src/utils/retry.rs` | The retry policy for throttled and overloaded answers, free of I/O |
| `src/utils/releases.rs`, `upgrade.rs`, `update_notice.rs` | `meetcal upgrade` and the daily new-release notice: the newest `cli-v*` release on GitHub, how this copy was installed and how to replace it (checked against the release's `SHA256SUMS`), and the notice's cache; `src/commands/upgrade.rs` runs `upgrade` |
| `src/utils/output.rs` | How results print: tables, or `--format json` / `csv` from the same `Report` |
| `src/utils/stats.rs` | Divisions, Sinclair (and its coefficients), attempt habits, PRs, source-error guards |
| `src/utils/athletes.rs` | Athletes' full histories |
| `src/utils/names.rs`, `bests.rs`, `format.rs` | Known names and suggestions, past-year bests, display formats |
| `src/utils/meet_names.rs` | Matching registration events to results meets (combined national events publish results under separate names) |
| `src/utils/make_rate.rs`, `sort.rs` | Make-rate tables, weight-class ordering |
| `src/types/` | Answer types shared across commands |
| `tests/` | Integration tests: argument parsing and help per command, and, against a local HTTP server (`tests/support/`), the retry policy, the access pass and `login`/`logout` |
| `scripts/build-release.sh` | Local release builds, for smoke testing |
| `scripts/homebrew-formula.sh` | Writes the Homebrew tap's formula from a release's version and `SHA256SUMS`; the release workflow runs it |
| `docs/` | [architecture.md](docs/architecture.md), [testing.md](docs/testing.md), [releasing.md](docs/releasing.md) |

## Commands

Run from this folder.

| Task | Command |
|---|---|
| Run a command | `cargo run -- <command> [args]`, e.g. `cargo run -- search "Maddisen Mohnsen"` |
| Against the dev deployment | `MEETCAL_CONVEX_URL=https://utmost-retriever-826.convex.cloud cargo run -- <command>` |
| Lint | `mise run lint` (`cargo fmt --check` + `clippy -D warnings`) |
| Tests | `cargo test` |
| Full gate | `mise run check-all` |
| Release build | `cargo build --release` |
| Dependency audit | `mise run audit` |

## Verify

| Gate | Command | Pass when |
|---|---|---|
| Format, lint, tests | `mise run check-all` | Exit 0 |
| Local run of every new or changed command | See below | Every one exits 0 with the expected output in all three formats |

**Before opening or updating a PR, run every command that is new or that the change touches, locally, against a real deployment** (production for reads, or the dev deployment with `MEETCAL_CONVEX_URL`). "Touches" includes commands that share code you changed: a change to `utils/output.rs`, `utils/backend.rs`, `utils/stats.rs` or a shared report module (`group_wrapped.rs`, `wso_results.rs`) means every command using it. For each command:

- run it with real names and its main flags, in `--format table`, `json` and `csv`: it exits 0, the table reads right, the JSON parses, and the CSV has its header;
- run it with a misspelled meet, club, WSO or athlete name where it takes one, and check the suggestion.

List what you ran in the PR's test plan, and anything you could not run and why. Unit tests use answer shapes written by hand, and CI never calls a deployment, so this local run is the only check that a command still works against live data.

CI (`.github/workflows/cli.yml` at the root) runs `cargo fmt --check`, `clippy -D warnings`, `cargo test --locked` and `cargo audit` (also weekly, since advisories arrive without a change here). The release workflow runs the tests and the audit again before it builds.

## Code Quality

- Commands print through `src/utils/output.rs` (`output::emit(Report::…)`), never `println!`: that is what makes `--format json|csv` work for every command.
- Every data call goes through `src/utils/backend.rs`: add a query to `queries`, never build a Convex URL in a command. Arguments are the query's own, camelCase (`serde_json::json!({ "ageCategory": age })`).
- Name lists travel as JSON arrays, in batches of at most 100 names (the queries' limit); the commands batch 50.
- Answer types are `serde` structs. A field that some answers lack (start-list rows carry no meet) is `#[serde(default)]` or an `Option`; free-form values from the data (platform names) are `String`, not enums.
- Keep network code out of report logic: commands fetch, then call pure functions (stats, comparisons, meet matching) that tests can drive with fixture rows.
- Errors are `anyhow` with context naming the query or the input; a user-facing failure says what to try (`bail!("No athletes found for WSO ...")`).
- `--version` comes from `Cargo.toml`: bump the version there, never in clap.
- A new premium Convex function goes in `PREMIUM_FUNCTIONS` (`src/utils/access.rs`) as well as the server's and the website's lists, and a premium action in `PREMIUM_ACTIONS` and the server's; keep each a plain `&[&str]` array literal. The saved login's token goes to `accessPass:pass`, `entitlements:refresh` and `apiTokens:revoke` only, never to a data read.
- Commands never prompt or open a browser: `login` must work with no terminal (SSH, servers, agents). Its prose goes to stderr.

## Recurring lessons

- Convex's HTTP API writes the numbers of a value answer as floats (`2.0`). `backend.rs` turns whole numbers back into integers so integer fields parse; the unit test in `backend.rs` guards it, since fixtures written by hand use integers.
- A query that reads a whole table or index range can pass on the dev deployment and fail on production, which has far more rows. Check a new or changed command against production before a release.
- A Convex view is fresh while its source tables are unchanged, whatever code built it: an answer that gains a field serves the old shape until the view is rebuilt (`../docs/backend.md`).
- The results hold a few source errors: impossible bodyweights (0.9 kg, 12 kg), totals that are not the snatch plus the clean & jerk, typo'd attempts (`[-63, 633, 65]`, whose best and total the source computes from the typo, so the total check passes them) and placeholder rows (`[100, 200, 300]`). Anything that ranks, maximizes or averages results must go through `stats.rs`: `plausible`, `valid_total`, `valid_lift`, `row_sinclair`, `row_qpoints` (and `pr_flags` for PRs), or one bad row tops the list.
- Sinclair and Q-points are separate scales for men and women: rank each gender on its own.
- British Weightlifting (`BWL`) results share the results table. USA comparisons (rankings, records, previous bests) leave them out unless asked for.
- Q-points use the published formula (`QPOINTS_*` in `stats.rs`, source: https://osf.io/8x3nb/); they do not apply to youth divisions (`qpoints_apply`), and Q-Masters needs an exact age the results do not carry, so the CLI does not compute it. The server's WSO elite lists (`elite`, `convex/lib/elite.ts`) do, with the age a member's registrations give.
- Sinclair uses the IWF's 2021–2024 coefficients (`SINCLAIR_MEN` / `SINCLAIR_WOMEN` in `stats.rs`), the latest set we could confirm; when the IWF publishes a newer set, change them there and the `SINCLAIR_LABEL`.
- The CLI never reads every result: an all-athletes leaderboard is ranked on the server (`results:leaderboard`, an action paging through the range), and the rules it ranks by are ported from `stats.rs` and `leaderboard.rs` (`convex/lib/leaderboard.ts`). A change to those rules here (`plausible`, Sinclair or Q-points, `Filters::keeps`, `rank`) must change the server's too: `tests/fixtures/scores.json` holds what `stats.rs` computes for a few hundred rows, and both `tests/score_fixtures.rs` and the server's Jest test check against it (regenerate it with `MEETCAL_UPDATE_FIXTURES=1 cargo test --test score_fixtures`). Every meet name is paged on the server (`meets:namesPage`); a single query that scans a large table passes on dev and fails on production.
- USA Weightlifting publishes some national events' start lists under one combined name and their results under separate ones. Go through `meet_names.rs` (`equivalent_meets`, `result_meet_aliases`) rather than comparing meet names directly.
- Many results meets keep one name every year (`Testify Leprechaun Lift-off`), and `results:byMeet` answers every year's rows for that name. A meet name alone is not one event: split rows into editions by year (`meet_names::editions_by_year`), and find a meet's other editions by `meet_names::series_name`, not by swapping the year in its name.
- Names are folded with Unicode NFC, like the server's `normalizeName`: use `stats::fold` for every name match.
