use clap::Parser;
use meetcal::parser::{Cli, Commands};

#[test]
fn parses_athlete_compare() {
    let cli = Cli::parse_from(["meetcal", "compare", "Maddisen Mohnsen"]);

    let Commands::Compare(args) = cli.command else {
        panic!("expected compare command");
    };

    assert_eq!(args.name, "Maddisen Mohnsen");
}

#[test]
fn rejects_compare_without_an_athlete() {
    assert!(Cli::try_parse_from(["meetcal", "compare"]).is_err());
}

#[test]
fn rejects_obsolete_year_count_argument() {
    assert!(Cli::try_parse_from(["meetcal", "compare", "Name", "2"]).is_err());
}
