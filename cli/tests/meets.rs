use clap::Parser;
use meetcal::parser::{Cli, Commands};

#[test]
fn parses_meets_arguments() {
    let cli = Cli::parse_from(["meetcal", "meets", "--completed", "--search", "virus"]);

    let Commands::Meets(args) = cli.command else {
        panic!("expected meets command");
    };

    assert!(args.completed);
    assert_eq!(args.search.as_deref(), Some("virus"));
}
