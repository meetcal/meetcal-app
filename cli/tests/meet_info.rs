use clap::Parser;
use meetcal::parser::{Cli, Commands};

#[test]
fn parses_meet_info_arguments() {
    let cli = Cli::parse_from(["meetcal", "meet-info", "Test Meet"]);

    let Commands::MeetInfo(args) = cli.command else {
        panic!("expected meet-info command");
    };

    assert_eq!(args.name, "Test Meet");
}
