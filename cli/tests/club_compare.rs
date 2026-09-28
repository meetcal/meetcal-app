use clap::Parser;
use meetcal::parser::{Cli, Commands};

#[test]
fn parses_club_compare() {
    let cli = Cli::parse_from(["meetcal", "club-compare", "POWER AND GRACE PERFORMANCE."]);

    let Commands::ClubCompare(args) = cli.command else {
        panic!("expected club-compare command");
    };

    assert_eq!(args.club, "POWER AND GRACE PERFORMANCE.");
}

#[test]
fn rejects_club_compare_without_club() {
    assert!(Cli::try_parse_from(["meetcal", "club-compare"]).is_err());
}

#[test]
fn rejects_year_arguments_because_comparison_is_fixed_to_calendar_years() {
    assert!(Cli::try_parse_from(["meetcal", "club-compare", "Club", "--year", "2025",]).is_err());
}
