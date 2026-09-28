# Changelog

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
