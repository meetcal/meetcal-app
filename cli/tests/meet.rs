use clap::Parser;
use meetcal::parser::{Cli, Commands};

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
    assert_eq!(args.session_platform.as_deref(), Some("red"));
}

#[test]
fn takes_any_platform_name() {
    let cli = Cli::parse_from(["meetcal", "meet", "Meet", "--session-platform", "Gold"]);

    let Commands::Meet(args) = cli.command else {
        panic!("expected meet command");
    };

    assert_eq!(args.session_platform.as_deref(), Some("Gold"));
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
