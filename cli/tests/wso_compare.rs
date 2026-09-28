use clap::Parser;
use meetcal::parser::{Cli, Commands};

#[test]
fn parses_wso_compare() {
    let cli = Cli::parse_from(["meetcal", "wso-compare", "Carolina"]);

    let Commands::WsoCompare(args) = cli.command else {
        panic!("expected wso-compare command");
    };
    assert_eq!(args.wso, "Carolina");
}

#[test]
fn requires_a_wso() {
    assert!(Cli::try_parse_from(["meetcal", "wso-compare"]).is_err());
}

#[test]
fn rejects_year_arguments_because_comparison_is_fixed_to_calendar_years() {
    assert!(Cli::try_parse_from(["meetcal", "wso-compare", "Carolina", "--year", "2025"]).is_err());
}
