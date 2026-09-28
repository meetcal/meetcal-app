use clap::Parser;
use meetcal::parser::{Cli, Commands};

#[test]
fn parses_wrapped_with_default_year() {
    let cli = Cli::parse_from(["meetcal", "wrapped", "Maddisen Mohnsen"]);

    let Commands::Wrapped(args) = cli.command else {
        panic!("expected wrapped command");
    };

    assert_eq!(args.name, "Maddisen Mohnsen");
    assert_eq!(args.year, None);
}

#[test]
fn parses_wrapped_with_calendar_year() {
    let cli = Cli::parse_from(["meetcal", "wrapped", "Maddisen Mohnsen", "--year", "2025"]);

    let Commands::Wrapped(args) = cli.command else {
        panic!("expected wrapped command");
    };

    assert_eq!(args.year, Some(2025));
}

#[test]
fn rejects_wrapped_with_invalid_year() {
    assert!(Cli::try_parse_from(["meetcal", "wrapped", "Name", "--year", "0"]).is_err());
    assert!(Cli::try_parse_from(["meetcal", "wrapped", "Name", "--year", "year"]).is_err());
}
