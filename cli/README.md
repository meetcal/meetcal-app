# MeetCal CLI

Rust command line tool for querying MeetCal lifting data from the MeetCal backend.

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
cargo install --git https://github.com/meetcal/meetcal-cli.git meetcal
```

Install from a local checkout:

```sh
git clone https://github.com/meetcal/meetcal-cli.git
cd meetcal-cli
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

### Meet reports

#### `meet`

Search meet entries by meet name. Optionally filter by session number and platform.

```sh
meetcal meet "2026 VIRUS Weightlifting Series 1"
meetcal meet "2026 VIRUS Weightlifting Series 1" --session-number 1 --session-platform red
```

Options:

- `--session-number`, `-s`: Session number
- `--session-platform`, `-p`: Platform (`red`, `white`, `blue`, `stars`, `stripes`, `rogue`)

#### `meet-results`

Show all lifting results and event statistics for a meet.

```sh
meetcal meet-results "2026 AZ Summer Slam Nationals Qualifier"
```

### Club reports

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

Search records by age group, gender, and federation.

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

Search WSO records by age group, gender, and WSO region.

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

```sh
just check-all
cargo run -- search "Maddisen Mohnsen"
cargo build --release
```

Release builds and Homebrew publishing steps are documented in [BREW.md](BREW.md).
