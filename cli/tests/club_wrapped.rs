use clap::Parser;
use meetcal::parser::{Cli, Commands};

#[test]
fn parses_club_wrapped_with_default_year() {
    let cli = Cli::parse_from(["meetcal", "club-wrapped", "Columbus Weightlifting"]);

    let Commands::ClubWrapped(args) = cli.command else {
        panic!("expected club-wrapped command");
    };

    assert_eq!(args.club, "Columbus Weightlifting");
    assert_eq!(args.year, None);
}

#[test]
fn parses_club_wrapped_with_year() {
    let cli = Cli::parse_from([
        "meetcal",
        "club-wrapped",
        "Columbus Weightlifting",
        "--year",
        "2025",
    ]);

    let Commands::ClubWrapped(args) = cli.command else {
        panic!("expected club-wrapped command");
    };

    assert_eq!(args.year, Some(2025));
}

#[test]
fn rejects_club_wrapped_without_club() {
    assert!(Cli::try_parse_from(["meetcal", "club-wrapped"]).is_err());
}
