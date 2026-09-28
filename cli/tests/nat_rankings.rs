use clap::Parser;
use meetcal::parser::{Cli, Commands};

#[test]
fn parses_nat_rankings_with_flags() {
    let cli = Cli::parse_from([
        "meetcal",
        "nat-rankings",
        "Junior Women's 77kg",
        "--federation",
        "USAW",
    ]);

    let Commands::NatRankings(args) = cli.command else {
        panic!("expected nat-rankings command");
    };

    assert_eq!(args.weight_class, "Junior Women's 77kg");
    assert_eq!(args.federation, "USAW");
}

#[test]
fn rejects_nat_rankings_without_federation_flag() {
    let cli = Cli::try_parse_from(["meetcal", "nat-rankings", "Junior Women's 77kg", "USAW"]);

    assert!(cli.is_err());
}
