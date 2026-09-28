use clap::Parser;
use meetcal::parser::{Cli, Commands};

#[test]
fn parses_wsos_arguments() {
    let cli = Cli::parse_from(["meetcal", "wsos", "Carolina"]);

    let Commands::Wsos(args) = cli.command else {
        panic!("expected wsos command");
    };

    assert_eq!(args.wso.as_deref(), Some("Carolina"));
}
