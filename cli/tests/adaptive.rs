use clap::Parser;
use meetcal::parser::{Cli, Commands};

#[test]
fn parses_intl_rankings_with_flags() {
    let cli = Cli::parse_from(["meetcal", "adaptive-records", "Men"]);

    let Commands::AdaptiveRecords(args) = cli.command else {
        panic!("expected adaptive-records command");
    };

    assert_eq!(args.gender, "Men");
}

#[test]
fn rejects_intl_rankings_without_flags() {
    let cli = Cli::try_parse_from(["meetcal", "adaptive-records", "--gender", "Men"]);

    assert!(cli.is_err());
}
