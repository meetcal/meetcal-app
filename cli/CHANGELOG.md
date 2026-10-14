# Changelog

## 3.0.0

Breaking: `meetcal results` is removed, and `leaderboard` without
`--club` or `--wso` needs `meetcal login` with a MeetCal subscription and a range of less than five
years. MeetCal no longer answers the bulk results query (`results:page`) that 2.4.0 and earlier read
for `leaderboard` and `results`, so those two commands fail on older releases: upgrade.

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
