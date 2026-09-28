use clap::Parser;
use meetcal::parser::{Cli, Commands};

#[test]
fn parses_records_with_flags() {
    let cli = Cli::parse_from([
        "meetcal",
        "records",
        "--age",
        "Senior",
        "--gender",
        "Men",
        "--federation",
        "USAW",
    ]);

    let Commands::Records(args) = cli.command else {
        panic!("expected records command");
    };

    assert_eq!(args.age, "Senior");
    assert_eq!(args.gender, "Men");
    assert_eq!(args.federation, "USAW");
}

#[test]
fn rejects_records_without_flags() {
    let cli = Cli::try_parse_from(["meetcal", "records", "Senior", "Men", "USAW"]);

    assert!(cli.is_err());
}
