use clap::Parser;
use meetcal::parser::{Cli, Commands};

#[test]
fn parses_clubs_arguments() {
    let cli = Cli::parse_from(["meetcal", "clubs", "-s", "texas"]);

    let Commands::Clubs(args) = cli.command else {
        panic!("expected clubs command");
    };

    assert_eq!(args.search.as_deref(), Some("texas"));
}
