use clap::Parser;
use meetcal::parser::{Cli, Commands};

#[test]
fn parses_wso_wrapped_with_default_year() {
    let cli = Cli::parse_from(["meetcal", "wso-wrapped", "Carolina"]);

    let Commands::WsoWrapped(args) = cli.command else {
        panic!("expected wso-wrapped command");
    };
    assert_eq!(args.wso, "Carolina");
    assert_eq!(args.year, None);
}

#[test]
fn parses_wso_wrapped_with_explicit_calendar_year() {
    let cli = Cli::parse_from(["meetcal", "wso-wrapped", "Carolina", "--year", "2025"]);

    let Commands::WsoWrapped(args) = cli.command else {
        panic!("expected wso-wrapped command");
    };
    assert_eq!(args.year, Some(2025));
}

#[test]
fn rejects_invalid_calendar_year() {
    assert!(Cli::try_parse_from(["meetcal", "wso-wrapped", "Carolina", "--year", "1899"]).is_err());
}
