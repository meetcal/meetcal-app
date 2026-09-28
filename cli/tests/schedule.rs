use clap::Parser;
use meetcal::parser::{Cli, Commands};

#[test]
fn parses_schedule_arguments() {
    let cli = Cli::parse_from([
        "meetcal",
        "schedule",
        "Test Meet",
        "--date",
        "2026-10-03",
        "--platform",
        "red",
    ]);

    let Commands::Schedule(args) = cli.command else {
        panic!("expected schedule command");
    };

    assert_eq!(args.name, "Test Meet");
    assert_eq!(args.date.as_deref(), Some("2026-10-03"));
    assert_eq!(args.platform.as_deref(), Some("red"));
}
