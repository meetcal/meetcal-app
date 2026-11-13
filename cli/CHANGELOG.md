# Changelog

## Unreleased

### Fixed

- Club and WSO reports (`club-wrapped`, `wso-wrapped`, `club-compare`, `wso-compare`,
  `club-trends`, `wso-trends`, and `leaderboard --club`/`--wso`) and `attendance` count each lifter
  once: two lifters who share a name count as two, and a lifter's PRs in the trends are read from
  their own results. A result Sport80 lists under no lifter counts as its name's only lifter when
  its division fits that lifter's age and gender, and as someone else when not. The all-athletes
  leaderboard, `nat-rankings`, `elite`, `club-results` and `wso` follow MeetCal's answers, which
  count the same way.

## 4.0.0

### Breaking changes

- `search`, `progress` and `qualify` show one lifter's results, not every result under a name.
  When more than one lifter has the name, they exit 1 with each lifter's id, age, WSO, club, result
  count and latest meet, instead of a combined history; run again with `--lifter <id>`, or
  `--other` for the name's results no one lifter holds. `h2h` takes `--first-lifter` and
  `--second-lifter`. They read MeetCal's `results:athlete`, which is on production.
- `meetcal wso` shows what `club-results` shows, from MeetCal's own answer
  (`reference:wsoMeetStats`) instead of ranking the meet itself. Its export is now the tables
  `summary` (`wso`, `meet`, `athletes`, `results`), `results` (`total_weight_lifted`,
  `snatch_make_rate`, `cj_make_rate`, `overall_make_rate`, `total_prs`, `6_for_6`), `medals`
  (`gold`, `silver`, `bronze`, `total`) and `athletes` (one row per lifter). The old tables
  `make_rates`, `volume`, `prs` and `pr_details` are gone, with the snatch and clean & jerk PR
  counts, the previous PR beside each new one, each medal's place and division, and the meet's
  total athlete count.
- Export keys have one spelling. Clean & jerk is `cj` wherever it appears, and a header's
  parenthesised note is not part of its key:
  - `c_j_make_rate` is `cj_make_rate` and `c_j_medal` is `cj_medal` (`club-results`, `wso`)
  - `best_c_j` is `best_cj` (`wrapped`, `club-wrapped`, `wso-wrapped`, `h2h`)
  - `c_j` is `cj` (`progress`, `leaderboard`, `elite`, `club-results`, `wso`);
    `past_year_c_j` is `past_year_cj` (`qualify`)
  - `sinclair_2021_24` is `sinclair` (`progress`, `meet-results`, `leaderboard`);
    `best_sinclair_2021_24` is `best_sinclair` (`h2h`, `club-trends`, `wso-trends`)
  - `top_meet_best_total` is `top_meet` (`club-wrapped`, `wso-wrapped`)
- A value that does not exist exports as null, not 0: a year with no results (and the difference
  against it) in `compare`, `club-compare` and `wso-compare`; a lift with no record in
  `adaptive-records`; a lift never made in `search`'s PRs.
- CSV writes a weight class as JSON does (`60kg`, not `60`) in every column whose header contains
  "class".
- `records` with a filter that matches nothing is an error naming the values the records have
  (exit 1), not an empty answer (exit 0).
- A bad `--gender`, a blank name, a `--year` outside 1900 to 9999 and a `meet --session-number`
  that is not a number are usage errors (exit 2) before any request.
- `club-results` and `wso` exit 1 with an explanation, instead of a report of zeros, when the
  club or WSO has athletes at a meet and none of their results are counted while MeetCal holds
  results under the meet's other names (a combined national meet whose results are not linked to
  it); the message names those meets and the `meet-results` command that shows them.
- `elite` without `--year` covers the current calendar year, as `leaderboard` does (it covered
  last year).
- `leaderboard`'s age category is `-a`. `-c` still works there but is no longer listed.

### Fixed

- `search` and `progress` mark PRs with MeetCal's rule, the one the app and meetcal.app use,
  instead of working them out from the rows.
- `meet-results` counts a lifter entered in two divisions once in its summary, bomb-outs, make
  rates and top-score tables; the results table still lists every row.
- `wsos` and `wso-records` report a failed lookup instead of answering with part of the data, and
  `wsos`' `registrations` column is always `true` or `false`.
- `club-trends` and `wso-trends` always export `gold`, `silver` and `bronze` (null under
  `--no-medals`), and `meet-results` always exports `editions`, so the keys do not depend on the
  flags.
- A club, WSO or meet name typed with a combining accent, or in capitals with an accented letter,
  finds the stored name.
- A read whose connection is refused or dropped before any answer is sent again, within the same
  two retries as a rate limit.
- A slow answer no longer fails after 30 seconds: a read fails only when nothing arrives for 20
  seconds (or no answer starts within 60), so `club-trends` and `wso-trends` finish on a slow link.
  An answer that stalls or whose connection drops part way is read again (twice at most).
- Offline, a command fails in about 17 seconds instead of 33 (66 for a logged-in subscriber
  command), and every network failure says to check the connection.

### Changed

- Every `--gender` takes `Men` or `Women`, and `m`, `f`, `male` and `female`. `meet-results`
  `--year` has the short form `-y`.
- Club and WSO reports read their athletes' results up to twelve requests at a time.
- Answers arrive gzipped, 8 to 22 times smaller.
- Reference tables, meet lists, schedules, start lists, meet results and the daily access pass
  are kept in `~/.cache/meetcal/` (`$XDG_CACHE_HOME/meetcal/`), at most 64 MB; a later run asks
  whether its copy is current instead of downloading it again. Subscriber data kept there goes when
  the pass changes and on `logout`.
- `records` and `qualifying-totals` read only the table asked for; `club-trends` and `wso-trends`
  read each meet's medals, `meet-results` each edition's summary and `attendance` the matching meet
  names from MeetCal, instead of downloading whole meets and every meet name. Their output is
  unchanged.
- `qualify`, `meet-results`' earlier editions, `attendance`'s multi-year meets and the suggestions
  for a misspelled athlete or meet are read side by side.
- On a terminal, a command that has printed nothing after a second shows "Fetching from MeetCal…"
  on stderr until its output starts; piped and redirected output is unchanged.
- TLS uses ring instead of aws-lc, which took most of every run's CPU, and release binaries are
  stripped and built with LTO: the download is about 3.2 MB instead of 4.5.
- Security: rustix past its unsoundness advisory.
- Release checks: a release's tag must be on `master`, and the macOS binaries are run before they
  are published.

## 3.1.0

- `meetcal elite <WSO>`: a WSO's top 20 women and men Overall, Youth, Junior, Senior and Masters,
  each list scored by % of A standard, Q-points, Q-masters or Sinclair (`--overall`, `--youth`,
  `--junior`, `--senior`, `--masters`), over last year, a `--year` or a `--from`/`--to` range.
  Ranked by MeetCal (`results:wsoElite`), so it needs `meetcal login` with a MeetCal subscription.
- Every command's help prints its examples one per line, and the examples that failed now run.
- Security: tokio 1.54.1 (RUSTSEC-2026-0386) and newer rustls-webpki and webpki-root-certs, past
  their advisories.
- Built with Rust 1.99.1.

## 3.0.0

Breaking: `meetcal results` is removed, and `leaderboard` without
`--club` or `--wso` needs `meetcal login` with a MeetCal subscription and a range of less than five
years. MeetCal no longer answers the bulk results query (`results:page`) that 2.4.0 and earlier read
for `leaderboard` and `results`, so those two commands fail on older releases: upgrade.

- `meetcal upgrade` installs the newest release the way meetcal was installed: `brew update` and
  `brew upgrade` for Homebrew, `cargo install` of the release's tag for Cargo, or, for a binary unpacked by hand, the
  release's archive for this machine, checked against the release's new `SHA256SUMS` file and run
  once before it replaces the binary. Where it cannot write, it says to run it with `sudo`; it
  never asks for rights itself. `meetcal upgrade --check` only says whether a newer release is out
  (exit 1 when one is, 2 when it cannot tell). On a terminal, other commands say once a day when one is out, asking
  GitHub at most once a day alongside their own work; `MEETCAL_NO_UPDATE_CHECK=1` or `CI` turns it
  off. 2.4.0 and earlier have no `upgrade`: upgrade them once with `brew upgrade meetcal`.
- `meetcal login` and `meetcal logout`. `login` signs this machine in to MeetCal with a code you
  approve on any signed-in device (a link and, in a terminal, a QR code), so it works over SSH, on
  servers and for AI agents; the login lasts 90 days and is saved in
  `~/.config/meetcal/credentials.json` (or under `$XDG_CONFIG_HOME`), readable by you alone.
  `logout` ends it and deletes the file.
- Commands that read subscriber data (results, rankings, records, standards, club and WSO data)
  send MeetCal's daily access pass when you are logged in with a subscription. Without a login they
  work as before for now; once MeetCal requires the pass, they say to run `meetcal login` (or that
  a subscription is needed). Schedules, start lists and meet lists stay free, with no login.
- `wrapped` and `compare` read an athlete's Wrapped from MeetCal (`results:wrapped`), the same
  answer as the app and meetcal.app, so they are free and need no login. The numbers now follow the
  app's rules where the CLI's differed: a lift listed twice (two divisions, or two days of one
  meet) counts once; a top-meet tie goes to the later meet; and Meet Regular counts results rather
  than meets. As before, source-error rows are left out, and each edition of a recurring meet is
  its own meet. The name must be exact (case and spacing aside), as before, with suggestions when
  it is not; `--year` now runs from 1900 to 2100. `results:wrapped` must be on the deployment
  first: release this after MeetCal's production deploy.
- Breaking: `meetcal results` is removed: MeetCal no longer offers every result in a range as a raw
  export. A meet's results (`meet-results`), an athlete's (`search`, `progress`) and a club's or
  WSO's results are still there.
- Breaking: `leaderboard` is ranked by MeetCal (`results:leaderboard`) instead of reading every
  result in the range (about 28,000 a year) into the CLI, so it answers in a second or two. The
  rules are the same: the CLI's own, moved to the server, with the same answers. Without `--club`
  or `--wso` it needs `meetcal login` and a MeetCal subscription, a range of less than five years,
  and `--limit` at most 500. `--wso` and `--club` leaderboards are ranked by the CLI, as before,
  with neither limit.
  `results:leaderboard` must be on the deployment first: release this after MeetCal's
  production deploy.

## 2.4.0

- Q-points, which USA Weightlifting has used for best lifters since 2025, alongside Sinclair:
  `leaderboard --by qpoints`, and a Q-points column in `progress`, `h2h`, `meet-results`, `results`,
  `club-trends` and `wso-trends`.
- `meet-results` ranks its best lifters by Q-points first, then Sinclair, and compares the best
  Q-points across the meet's editions.
- Q-points follow the published formula (Huebner, Meltzer, Bjarnason and Perperoglou, 2023): for
  juniors, seniors and Masters, not youth divisions; lifters under 50 kg (men) or 41 kg (women)
  are scored at that bodyweight.
- JSON and CSV exports have a fixed schema: CSV writes the values JSON gets (empty fields for
  placeholders, `true`/`false`, numbers without their unit), and `meet` always has the three
  past-year best columns, null with `--no-bests`.
- Tables fit the terminal, and piping into a command that closes early (`| head`) no longer panics.
- A bad name or filter says why instead of printing an empty table; `progress --since` past the
  last result says so, and its trend's Meets column counts meets, not result rows.
- `records` and `wso-records` show a lift with no record set, and a missing standard, as a dash
  rather than 0, and keep classes with one unset lift.
- `leaderboard` and `results` read a date range in parallel slices, and clear the progress line when
  they fail.
- Rankings, trends, `wrapped` and `wso` agree with the app and server: source-error rows,
  mixed-gender scores and British Weightlifting results stay out of USA rankings; medals place one
  result per athlete per division, as the server does; a bomb-out sets a zero mark, so the next made
  lift is a PR; make rates and weight lifted count one best result per athlete.
- `qualify` counts only USAW results at a plausible bodyweight, and maps a retired class to the
  current one by the bodyweight the total was made at.
- Each year of a meet that keeps its name is its own edition (`attendance`, trends, `meet-results`);
  upcoming registrations get their own edition, and names match across composed and decomposed
  accents.
- A combined national event's results show under every title it publishes, and are counted once in
  trends, attendance and WSO results.
- `wrapped` and `compare` refuse a year the search cut short and point to `progress --since`; club
  and WSO athlete lists are paged, so a large club no longer fails.
- Linux binaries are built against glibc 2.17, so they run on older distributions (Ubuntu 22.04,
  Debian 11 and 12, RHEL 9, Amazon Linux 2023), and the dependencies carry no open RustSec
  advisories.

## 2.3.0

Stats across all of MeetCal's data, and output for other tools.

- `--format json` and `--format csv` on every command.
- `leaderboard` ranks athletes by best total, snatch, clean & jerk or Sinclair over a year or date
  range, across every class, filtered by gender, age category, division, federation, WSO or club.
- `results` exports every result in a range with every attempt and its Sinclair.
- `progress` shows an athlete's meets with Sinclair and PRs, their trend, and their attempt habits
  (make rate by attempt, jumps between attempts, openers, bomb-outs).
- `qualify` shows how far an athlete's past-year best is from the A/B standards and each event's
  qualifying total in their class.
- `h2h` compares two athletes at the meets they both entered.
- `attendance` counts a meet's athletes year after year, across the name changes between editions,
  from registrations as well as results.
- `club-trends` and `wso-trends` show a club's or WSO's results by year (athletes, meets, make rate,
  weight lifted, best total, PRs, medals) and its top lifters of all time.
- `meet-results` adds Sinclair, a summary, the heaviest lifts, the top Sinclair lifters, and a
  comparison with the meet's previous editions (`--no-history` skips it).
- A misspelled athlete name suggests the closest athletes (`progress`, `h2h`, `qualify`).
- `meet-info`'s JSON and CSV have one field per column.
- Sinclair uses the IWF's 2021–2024 coefficients. Results with an impossible bodyweight or a total
  that is not the snatch plus clean & jerk (source errors) get no Sinclair and stay off
  leaderboards.

## 2.2.0

The CLI now shows the meet and record data the app and meetcal.app do.

- `meets` lists upcoming meets, or completed ones with `--completed`, filtered with `--search`.
- `meet-info` shows a meet's dates, status, venue and address, time zone and venue maps.
- `schedule` shows a meet's sessions: date, platform, weigh-in and start times, and weight classes.
- `meet` adds each athlete's session date, weigh-in and start times, and their best snatch, clean
  & jerk and total over the past year (`--no-bests` leaves those out). The session number and
  platform now share one column.
- `records` and `wso-records` show who set each lift, when and where.
- `clubs` and `wsos` list the names the club and WSO commands expect; `wsos <WSO>` lists the age
  groups it keeps records for.
- A command given a meet, club or WSO name MeetCal does not know suggests the closest ones it
  does; `wso-records` with an age group the WSO does not keep lists the ones it does.

## 2.1.0

- Reads MeetCal's Convex backend, the same one the app and meetcal.app read, instead of the retired
  `api.meetcal.app` Rust API. Answers match 2.0.1's; see the notes below for the few that differ.
- Lives in the `meetcal/meetcal-app` repository under `cli/`; releases are published there as
  `cli-vX.Y.Z`.
- `meet` works again: start lists failed to parse in 2.0.1 because their rows carry no meet name.
  Platforms other than the six listed in `--session-platform` now show instead of failing.
- `club-results` reads medal and PR counts correctly from Convex.
- Athlete names containing a comma are sent as one name.
- `nat-ranking-year`: when an athlete hit their best total more than once in the year, the date
  shown is the first time.
- `MEETCAL_CONVEX_URL` points the CLI at another Convex deployment.
