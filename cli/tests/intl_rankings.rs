use clap::Parser;
use meetcal::parser::{Cli, Commands};

#[test]
fn parses_intl_rankings_with_flags() {
    let cli = Cli::parse_from([
        "meetcal",
        "intl-rankings",
        "--age",
        "Senior",
        "--gender",
        "Men",
        "--meet",
        "Worlds",
    ]);

    let Commands::IntlRankings(args) = cli.command else {
        panic!("expected intl-rankings command");
    };

    assert_eq!(args.age, "Senior");
    assert_eq!(args.gender, "Men");
    assert_eq!(args.meet, "Worlds");
}

#[test]
fn rejects_intl_rankings_without_flags() {
    let cli = Cli::try_parse_from(["meetcal", "intl-rankings", "Senior", "Men", "Worlds"]);

    assert!(cli.is_err());
}
