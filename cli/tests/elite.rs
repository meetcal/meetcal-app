use clap::Parser;
use meetcal::commands::elite::Method;
use meetcal::parser::{Cli, Commands};

#[test]
fn parses_elite_with_defaults() {
    let cli = Cli::parse_from(["meetcal", "elite", "Carolina"]);

    let Commands::Elite(args) = cli.command else {
        panic!("expected elite command");
    };
    assert_eq!(args.wso, "Carolina");
    assert_eq!(args.year, None);
    assert_eq!(args.masters, None);
}

#[test]
fn parses_each_lists_score_and_a_range() {
    let cli = Cli::parse_from([
        "meetcal",
        "elite",
        "Carolina",
        "--from",
        "2025-07-01",
        "--to",
        "2026-06-30",
        "--overall",
        "sinclair",
        "--masters",
        "percent-a",
        "--senior",
        "qpoints",
    ]);

    let Commands::Elite(args) = cli.command else {
        panic!("expected elite command");
    };
    assert_eq!(args.from.as_deref(), Some("2025-07-01"));
    assert_eq!(args.overall, Some(Method::Sinclair));
    assert_eq!(args.masters, Some(Method::PercentA));
    assert_eq!(args.senior, Some(Method::Qpoints));
}

#[test]
fn rejects_an_unknown_score_and_a_lone_from() {
    assert!(Cli::try_parse_from(["meetcal", "elite", "Carolina", "--youth", "total"]).is_err());
    assert!(Cli::try_parse_from(["meetcal", "elite", "Carolina", "--from", "2025-01-01"]).is_err());
}
