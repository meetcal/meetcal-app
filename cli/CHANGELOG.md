# Changelog

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
