# MeetCal CLI

Rust command line tool for querying MeetCal lifting data. It reads the same Convex backend as the
MeetCal app and meetcal.app, from `convex/` at the root of this repository.

MeetCal CLI 2.0 adds calendar-year Wrapped reports and year-over-year comparisons for athletes,
clubs, and Weightlifting State Organizations (WSOs).

## Install

### Homebrew

```sh
brew tap meetcal/tap
brew install meetcal
```

Upgrade later:

```sh
brew update
brew upgrade meetcal
```

### Cargo

Install the latest release from GitHub:

```sh
cargo install --git https://github.com/meetcal/meetcal-app.git meetcal
```

Install from a local checkout:

```sh
git clone https://github.com/meetcal/meetcal-app.git
cd meetcal-app/cli
cargo install --path .
```

Requirements: [Rust](https://www.rust-lang.org/tools/install) 1.85+.

## Verify

```sh
meetcal --help
meetcal --version
```

## Commands

Run `meetcal <command> --help` for the complete arguments accepted by any command.

Meet, club and WSO names must be exact. A command given a name MeetCal does not know suggests the
closest ones it does; `meets`, `clubs` and `wsos` list them.

### Athlete reports

#### `search`

Search for an athlete by name. Prints meet results, comp PRs, and make rates.

```sh
meetcal search "Maddisen Mohnsen"
```

#### `wrapped`

Show an athlete's Weightlifting Wrapped for a calendar year. The report includes meets competed,
make rate, total weight lifted, best lifts, average total, top meet, first-to-last improvement,
longest make streak, favorite attempt, and year status.

```sh
meetcal wrapped "Maddisen Mohnsen"
meetcal wrapped "Maddisen Mohnsen" --year 2025
```

Options:

- `--year`, `-y`: Calendar year to summarize; defaults to the current calendar year

#### `compare`

Compare an athlete's current calendar year with the previous calendar year. Every metric includes
the percentage difference when the previous year has a non-zero baseline.

```sh
meetcal compare "Maddisen Mohnsen"
```

The comparison years are fixed to the current and previous calendar years. In 2026, for example,
the command compares 2026 with 2025.

### Meets

#### `meets`

List meets: upcoming ones (starting within three months, or under way) by default, or completed
ones, newest first.

```sh
meetcal meets
meetcal meets --completed --search virus
```

Options:

- `--completed`, `-c`: List completed meets instead
- `--search`, `-s`: Only meets whose name contains this text

#### `meet-info`

Show a meet's dates, status, federation, venue and address, time zone, and venue map links.

```sh
meetcal meet-info "2026 Florida State Championships (WSO Championships)"
```

#### `schedule`

Show a meet's sessions: date, session, platform, weigh-in and start times (in the meet's time
zone), and the weight classes in each.

```sh
meetcal schedule "2026 Florida State Championships (WSO Championships)"
meetcal schedule "2026 Florida State Championships (WSO Championships)" --date 2026-09-26 --platform red
```

Options:

- `--date`, `-d`: Only this day's sessions (`YYYY-MM-DD`)
- `--platform`, `-p`: Only this platform's sessions

#### `meet`

Show a meet's start list: each athlete's age, club, class and entry total, their session's date,
weigh-in and start times, and their best snatch, clean & jerk and total over the past year.
Optionally filter by session number and platform.

```sh
meetcal meet "2026 VIRUS Weightlifting Series 1"
meetcal meet "2026 VIRUS Weightlifting Series 1" --session-number 1 --session-platform red
```

Options:

- `--session-number`, `-s`: Session number
- `--session-platform`, `-p`: Platform to filter by (`red`, `white`, `blue`, `stars`, `stripes`, `rogue`); results show whatever platform the meet uses
- `--no-bests`: Leave out the past-year bests

#### `meet-results`

Show all lifting results and event statistics for a meet.

```sh
meetcal meet-results "2026 AZ Summer Slam Nationals Qualifier"
```

### Club reports

#### `clubs`

List club names as the club commands expect them.

```sh
meetcal clubs --search "texas barbell"
```

Options:

- `--search`, `-s`: Only clubs whose name contains this text

#### `club-results`

Analyze a club's performance at one meet, including athletes, make rates, volume, PRs, medals, and
individual result details.

```sh
meetcal club-results \
  --club "POWER AND GRACE PERFORMANCE." \
  --meet "2025 UMWF World Championships"
```

Options:

- `--club`, `-c`: Exact club name
- `--meet`, `-m`: Exact meet name

#### `club-wrapped`

Show a club's calendar-year Wrapped report. It includes athlete count, meets, make rate, total
weight lifted, best lifts, average total, and top meet.

```sh
meetcal club-wrapped "Columbus Weightlifting"
meetcal club-wrapped "Columbus Weightlifting" --year 2025
```

Options:

- `--year`, `-y`: Calendar year to summarize; defaults to the current calendar year

#### `club-compare`

Compare a club's current calendar year with the previous calendar year, including percentage
differences for athletes, volume, meets, make rate, best lifts, and average total.

```sh
meetcal club-compare "POWER AND GRACE PERFORMANCE."
```

### WSO reports

#### `wsos`

List WSOs, or the age groups one keeps records for (the values `wso-records --age` takes).

```sh
meetcal wsos
meetcal wsos Carolina
```

#### `wso`

Analyze one WSO's athletes at a meet. The report includes meet participation, make rates, total
weight lifted, PRs, medals, and athlete detail.

```sh
meetcal wso \
  "2026 Masters National Championships & National University Championships" \
  --wso Carolina
```

MeetCal resolves combined USA Weightlifting registration events to their individual results meets,
such as Masters Nationals and National University Championships.

Options:

- `--wso`, `-w`: Exact WSO name

#### `wso-wrapped`

Show a WSO's calendar-year Wrapped report.

```sh
meetcal wso-wrapped Carolina
meetcal wso-wrapped Carolina --year 2025
```

Options:

- `--year`, `-y`: Calendar year to summarize; defaults to the current calendar year

#### `wso-compare`

Compare a WSO's current calendar year with the previous calendar year and show percentage
differences for every metric.

```sh
meetcal wso-compare Carolina
```

### Records, rankings, and standards

#### `records`

Search records by age group, gender, and federation. Each lift shows who set it, and when and
where when the source says ("Standard" when nobody has claimed it yet).

```sh
meetcal records --age Senior --gender Men --federation USAW
```

Options:

- `--age`, `-a`: Age group
- `--gender`, `-g`: Gender
- `--federation`, `-f`: `IWF`, `USAW`, `USAMW`, or `UMWF`

#### `standards`

Search USAW A/B standards for an age group and gender.

```sh
meetcal standards --age Senior --gender Men
```

Options:

- `--age`, `-a`: Age group
- `--gender`, `-g`: Gender

#### `qualifying-totals`

Search qualifying totals for an age group, gender, and event.

```sh
meetcal qualifying-totals --age Senior --gender Men --event Nationals
```

Options:

- `--age`, `-a`: Age group
- `--gender`, `-g`: Gender
- `--event`, `-e`: Event name

#### `nat-rankings`

Search national rankings for a weight class and federation.

```sh
meetcal nat-rankings "Junior Women's 77kg" --federation USAW
```

Options:

- `--federation`, `-f`: `USAW` or `USAMW`

#### `intl-rankings`

Search international rankings for an age group, gender, and meet.

```sh
meetcal intl-rankings --age Senior --gender Men --meet Worlds
```

Options:

- `--age`, `-a`: Age group
- `--gender`, `-g`: Gender
- `--meet`, `-m`: Meet name

#### `wso-records`

Search WSO records by age group, gender, and WSO region, with each lift's holder, date and place
as for `records`.

```sh
meetcal wso-records --age Senior --gender Men --wso Carolina
```

Options:

- `--age`, `-a`: Age group (e.g. `U17`, `Junior`, `Senior`, `Masters 35`)
- `--gender`, `-g`: `Men` or `Women`
- `--wso`, `-w`: WSO region (e.g. `Carolina`, `Florida`)

#### `adaptive-records`

Search Adaptive American Records by gender.

```sh
meetcal adaptive-records Women
```

## Development

Run these from `cli/`:

```sh
just check-all
cargo run -- search "Maddisen Mohnsen"
cargo build --release
```

The CLI reads the production Convex deployment. Point it at another one, such as the dev
deployment, with `MEETCAL_CONVEX_URL`:

```sh
MEETCAL_CONVEX_URL=https://utmost-retriever-826.convex.cloud cargo run -- records --age Senior --gender Men --federation USAW
```

Every Convex query the CLI reads is listed in `src/utils/backend.rs`.

How the CLI works is in [docs/architecture.md](docs/architecture.md), testing in
[docs/testing.md](docs/testing.md), and release builds and Homebrew publishing in
[docs/releasing.md](docs/releasing.md).
