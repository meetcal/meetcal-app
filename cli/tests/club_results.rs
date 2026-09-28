use clap::Parser;
use meetcal::parser::{Cli, Commands};

#[test]
fn parses_club_results_with_required_flags() {
    let cli = Cli::parse_from([
        "meetcal",
        "club-results",
        "--club",
        "Columbus Weightlifting",
        "--meet",
        "2026 Ohio WSO Championships",
    ]);

    let Commands::ClubResults(args) = cli.command else {
        panic!("expected club-results command");
    };

    assert_eq!(args.club, "Columbus Weightlifting");
    assert_eq!(args.meet, "2026 Ohio WSO Championships");
}

#[test]
fn rejects_club_results_without_meet() {
    let cli = Cli::try_parse_from([
        "meetcal",
        "club-results",
        "--club",
        "Columbus Weightlifting",
    ]);

    assert!(cli.is_err());
}

#[test]
fn rejects_positional_club_results_arguments() {
    let cli = Cli::try_parse_from([
        "meetcal",
        "club-results",
        "Columbus Weightlifting",
        "2026 Ohio WSO Championships",
    ]);

    assert!(cli.is_err());
}
