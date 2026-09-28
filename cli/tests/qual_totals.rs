use clap::Parser;
use meetcal::parser::{Cli, Commands};

#[test]
fn parses_qualifying_totals_with_flags() {
    let cli = Cli::parse_from([
        "meetcal",
        "qualifying-totals",
        "--age",
        "Senior",
        "--gender",
        "Men",
        "--event",
        "Nationals",
    ]);

    let Commands::QualifyingTotals(args) = cli.command else {
        panic!("expected qualifying-totals command");
    };

    assert_eq!(args.age, "Senior");
    assert_eq!(args.gender, "Men");
    assert_eq!(args.event, "Nationals");
}

#[test]
fn rejects_qualifying_totals_without_flags() {
    let cli = Cli::try_parse_from(["meetcal", "qualifying-totals", "Senior", "Men", "Nationals"]);

    assert!(cli.is_err());
}
