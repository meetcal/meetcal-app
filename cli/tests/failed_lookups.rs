#![cfg(test)]
mod support {
    pub(crate) mod failures;
    pub(crate) mod server;
}

use std::process::{Command, Output};

use serde_json::json;
use support::failures::FUNCTION_FAILED;
use support::server::{OK, Reply, reply, serve};

fn text(rows: serde_json::Value) -> Reply {
    let body = json!({ "status": "success", "value": { "json": rows.to_string() } });
    reply(OK, None, body.to_string())
}

fn failed(status: u16, error: &str) -> Reply {
    let body = json!({
        "status": "error",
        "errorMessage": "Server Error",
        "errorData": { "status": status, "error": error },
    });
    reply(FUNCTION_FAILED, None, body.to_string())
}

fn run(args: &[&str], replies: Vec<Reply>) -> Output {
    let (base_url, _requests) = serve(replies);
    run_against(&base_url, args)
}

fn run_against(base_url: &str, args: &[&str]) -> Output {
    let config =
        std::env::temp_dir().join(format!("meetcal-failed-lookups-{}", std::process::id()));
    Command::new(env!("CARGO_BIN_EXE_meetcal"))
        .args(args)
        .env("MEETCAL_CONVEX_URL", base_url)
        .env("XDG_CONFIG_HOME", &config)
        .env("XDG_CACHE_HOME", &config)
        .env("MEETCAL_NO_UPDATE_CHECK", "1")
        .output()
        .expect("run meetcal")
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

#[test]
fn wsos_fails_when_the_registration_names_cannot_be_read() {
    let output = run(
        &["wsos", "--format", "json"],
        vec![
            text(json!(["Carolina", "Florida"])),
            failed(503, "this list is being built; try again in a minute"),
        ],
    );
    let stderr = stderr(&output);
    assert_eq!(output.status.code(), Some(1), "stderr: {stderr}");
    assert!(output.stdout.is_empty(), "printed a partial list");
    assert!(stderr.contains("reference:registrationWsos"), "{stderr}");
}

#[test]
fn wso_records_does_not_call_a_wso_unknown_when_its_age_groups_cannot_be_read() {
    let output = run(
        &[
            "wso-records",
            "--age",
            "Seniors",
            "--gender",
            "Men",
            "--wso",
            "Carolina",
        ],
        vec![text(json!([])), failed(503, "try again in a minute")],
    );
    let stderr = stderr(&output);
    assert_eq!(output.status.code(), Some(1), "stderr: {stderr}");
    assert!(stderr.contains("reference:wsoAgeGroups"), "{stderr}");
    assert!(!stderr.contains("No records found for WSO"), "{stderr}");
}

#[test]
fn wso_suggestions_never_come_from_the_record_sheets_names() {
    let no_registrations =
        json!({ "status": "success", "value": { "json": "[]", "cursor": "end", "isDone": true } });
    let (base_url, requests) = serve(vec![
        reply(OK, None, no_registrations.to_string()),
        failed(503, "try again in a minute"),
        text(json!(["Carolina"])),
    ]);
    let output = run_against(&base_url, &["wso-wrapped", "Carolin"]);
    let stderr = stderr(&output);
    assert_eq!(output.status.code(), Some(1), "stderr: {stderr}");
    assert!(
        stderr.contains("No meet registrations found for WSO \"Carolin\""),
        "{stderr}"
    );
    assert!(!stderr.contains("Did you mean"), "{stderr}");
    assert_eq!(requests.lock().unwrap().len(), 2, "{stderr}");
}

#[test]
fn meet_info_knows_an_unknown_meet_by_its_status() {
    let output = run(
        &["meet-info", "No Such Meet"],
        vec![failed(404, "no meet by that name")],
    );
    let stderr = stderr(&output);
    assert_eq!(output.status.code(), Some(1), "stderr: {stderr}");
    assert!(
        stderr.contains("No meet named \"No Such Meet\""),
        "{stderr}"
    );
}
