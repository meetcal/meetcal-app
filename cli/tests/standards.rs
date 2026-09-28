use clap::Parser;
use meetcal::parser::{Cli, Commands};

#[test]
fn parses_standards_with_flags() {
    let cli = Cli::parse_from(["meetcal", "standards", "--age", "Senior", "--gender", "Men"]);

    let Commands::Standards(args) = cli.command else {
        panic!("expected standards command");
    };

    assert_eq!(args.age, "Senior");
    assert_eq!(args.gender, "Men");
}

#[test]
fn rejects_standards_without_flags() {
    let cli = Cli::try_parse_from(["meetcal", "standards", "Senior", "Men"]);

    assert!(cli.is_err());
}
