//! Date options are parsed before any request, so a bad value names the option and the format.

use clap::Parser;
use meetcal::parser::{Cli, Commands};

#[test]
fn a_range_that_is_not_dates_fails_on_its_option() {
    for command in ["leaderboard", "results"] {
        let error = Cli::try_parse_from([
            "meetcal",
            command,
            "--from",
            "garbage",
            "--to",
            "2026-01-01",
        ])
        .err()
        .unwrap_or_else(|| panic!("{command} took --from garbage"))
        .to_string();
        assert!(error.contains("--from"), "{error}");
        assert!(error.contains("YYYY-MM-DD"), "{error}");
        assert!(
            Cli::try_parse_from([
                "meetcal",
                command,
                "--from",
                "2026-01-01",
                "--to",
                "2026-02-30"
            ])
            .is_err()
        );
    }
}

#[test]
fn a_range_reads_as_iso_dates() {
    let cli = Cli::parse_from([
        "meetcal",
        "results",
        "--from",
        "Jun 1, 2026",
        "--to",
        "2026-06-30",
    ]);
    let Commands::Results(args) = cli.command else {
        panic!("expected results");
    };
    assert_eq!(args.from.as_deref(), Some("2026-06-01"));
    assert_eq!(args.to.as_deref(), Some("2026-06-30"));
}

#[test]
fn schedule_takes_the_date_as_its_table_shows_it() {
    let cli = Cli::parse_from(["meetcal", "schedule", "Meet", "--date", "Sep 25, 2026"]);
    let Commands::Schedule(args) = cli.command else {
        panic!("expected schedule");
    };
    assert_eq!(args.date.as_deref(), Some("2026-09-25"));
    assert!(Cli::try_parse_from(["meetcal", "schedule", "Meet", "--date", "2026-13-45"]).is_err());
}
