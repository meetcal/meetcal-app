#![cfg(test)]
use clap::Parser;
use meetcal::parser::{Cli, Commands};
use meetcal::utils::stats::Gender;

#[test]
fn parses_standards_with_flags() {
    let cli = Cli::parse_from([
        "meetcal",
        "wso-records",
        "--age",
        "Senior",
        "--gender",
        "Men",
        "--wso",
        "Carolina",
    ]);

    let Commands::WsoRecords(args) = cli.command else {
        panic!("expected standards command");
    };

    assert_eq!(args.age, "Senior");
    assert_eq!(args.gender, Gender::Men);
    assert_eq!(args.wso, "Carolina")
}

#[test]
fn rejects_standards_without_flags() {
    let cli = Cli::try_parse_from(["meetcal", "wso-records", "Senior", "Men", "Carolina"]);

    assert!(cli.is_err());
}
