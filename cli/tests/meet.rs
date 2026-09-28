use clap::Parser;
use meetcal::{
    parser::{Cli, Commands},
    types::athletes::Platform,
};

#[test]
fn parses_meet_command() {
    let cli = Cli::parse_from(["meetcal", "meet", "2026 VIRUS Weightlifting Series 1"]);

    let Commands::Meet(args) = cli.command else {
        panic!("expected meet command");
    };

    assert_eq!(args.name, "2026 VIRUS Weightlifting Series 1");
}

#[test]
fn parses_meet_with_flags() {
    let cli = Cli::parse_from([
        "meetcal",
        "meet",
        "2026 VIRUS Weightlifting Series 1",
        "--session-number",
        "1",
        "--session-platform",
        "red",
    ]);

    let Commands::Meet(args) = cli.command else {
        panic!("expected meet command");
    };

    assert_eq!(args.name, "2026 VIRUS Weightlifting Series 1");
    assert_eq!(args.session_number, Some("1".to_string()));
    assert!(matches!(args.session_platform, Some(Platform::Red)));
}

#[test]
fn parses_meet_without_flags() {
    let cli = Cli::try_parse_from([
        "meetcal",
        "meet",
        "2026 VIRUS Weightlifting Series 1",
        "1",
        "red",
    ]);

    assert!(cli.is_err());
}
