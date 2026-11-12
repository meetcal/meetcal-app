#![cfg(test)]
mod support {
    pub(crate) mod bodies;
    pub(crate) mod server;
}

use std::process::Command;

use clap::Parser;
use meetcal::parser::{Cli, Commands};
use serde_json::json;
use support::bodies::request_bodies;
use support::server::{OK, reply, serve};

#[test]
fn parses_meets_arguments() {
    let cli = Cli::parse_from(["meetcal", "meets", "--completed", "--search", "virus"]);

    let Commands::Meets(args) = cli.command else {
        panic!("expected meets command");
    };

    assert!(args.completed);
    assert_eq!(args.search.as_deref(), Some("virus"));
}

#[test]
fn completed_since_asks_for_that_window_and_names_it_when_nothing_starts_in_it() {
    let body = json!({ "status": "success", "value": { "json": "[]" } });
    let (base_url, requests) = serve(vec![reply(OK, None, body.to_string())]);
    let config = std::env::temp_dir().join(format!("meetcal-meets-since-{}", std::process::id()));
    let output = Command::new(env!("CARGO_BIN_EXE_meetcal"))
        .args(["meets", "--completed", "--since", "2030-01-01"])
        .env("MEETCAL_CONVEX_URL", &base_url)
        .env("XDG_CONFIG_HOME", &config)
        .env("MEETCAL_NO_UPDATE_CHECK", "1")
        .output()
        .expect("run meetcal");

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert_eq!(output.status.code(), Some(0), "stderr: {stderr}");
    let bodies = request_bodies(&requests);
    assert_eq!(bodies.len(), 1, "{bodies:?}");
    assert_eq!(bodies[0]["path"], "meets:completed");
    assert_eq!(bodies[0]["args"], json!({ "since": "2030-01-01" }));
    assert!(
        format!("{stdout}{stderr}").contains("No completed meets starting on or after 2030-01-01."),
        "stdout: {stdout} stderr: {stderr}"
    );
}
