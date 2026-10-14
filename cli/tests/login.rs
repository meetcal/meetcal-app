//! `meetcal login` and `logout` against a local HTTP server that plays Convex's device login
//! (`convex/deviceLogin.ts`). Nothing here calls the live API.

mod support;

use std::path::PathBuf;

use clap::CommandFactory;
use meetcal::commands::login::{login, logout};
use meetcal::parser::Cli;
use meetcal::utils::credentials::{self, Credentials};
use serde_json::json;
use support::{
    FUNCTION_FAILED, OK, RATE_LIMITED, UNAVAILABLE, authorizations, reply, request_bodies,
    request_paths, serve,
};

const FAR_FUTURE: i64 = 4_102_444_800_000;
const DEVICE: &str = "meetcal CLI on test-host (Linux)";

fn started(interval: u64) -> String {
    format!(
        r#"{{"status":"success","value":{{"deviceCode":"secret-device-code","userCode":"BCDF-GHJK","verificationUrl":"https://meetcal.app/link","expiresAt":{FAR_FUTURE}.0,"interval":{interval}.0}}}}"#
    )
}

fn polled(status: &str) -> String {
    format!(r#"{{"status":"success","value":{{"status":"{status}"}}}}"#)
}

fn approved(token: &str) -> String {
    format!(
        r#"{{"status":"success","value":{{"status":"approved","token":"{token}","tokenId":"tid-{token}","expiresAt":{FAR_FUTURE}.0}}}}"#
    )
}

const SUBSCRIBED: &str =
    r#"{"status":"success","value":{"pass":"p1","rotatesAt":4102444800000.0}}"#;
const NOT_SUBSCRIBED: &str = r#"{"status":"error","errorMessage":"Server Error","errorData":{"status":403,"error":"subscription required"}}"#;
const REVOKED: &str = r#"{"status":"success","value":null}"#;

fn refreshed(active: bool) -> String {
    format!(r#"{{"status":"success","value":{{"active":{active}}}}}"#)
}

fn scratch(test: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("meetcal-login-{test}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir.join("meetcal").join("credentials.json")
}

fn saved(token: &str, deployment: &str) -> Credentials {
    Credentials {
        token: token.to_string(),
        token_id: format!("tid-{token}"),
        expires_at: FAR_FUTURE,
        deployment: deployment.to_string(),
    }
}

#[tokio::test]
async fn login_shows_the_code_polls_and_saves_the_token() {
    let (base_url, requests) = serve(vec![
        reply(OK, None, started(1)),
        reply(OK, None, polled("pending")),
        reply(OK, None, approved("new")),
        reply(OK, None, SUBSCRIBED),
    ]);
    let path = scratch("approved");
    let mut out = Vec::new();

    let login = login(&base_url, &path, DEVICE, false, &mut out)
        .await
        .unwrap();

    assert_eq!(login, saved("new", &base_url));
    assert_eq!(
        credentials::load(&path).unwrap(),
        Some(saved("new", &base_url))
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    let printed = String::from_utf8(out).unwrap();
    for expected in [
        "Open https://meetcal.app/link?code=BCDF-GHJK",
        "the code BCDF-GHJK",
        DEVICE,
        "Waiting for approval",
        "Logged in.",
        "subscription is active",
    ] {
        assert!(
            printed.contains(expected),
            "missing {expected:?} in:\n{printed}"
        );
    }
    // No QR code without a terminal, and the device code is never shown.
    assert!(!printed.contains('\x1b'));
    assert!(!printed.contains("secret-device-code"));

    let bodies = request_bodies(&requests);
    assert_eq!(
        bodies
            .iter()
            .map(|body| body["path"].clone())
            .collect::<Vec<_>>(),
        [
            json!("deviceLogin:start"),
            json!("deviceLogin:poll"),
            json!("deviceLogin:poll"),
            json!("accessPass:pass"),
        ]
    );
    assert_eq!(bodies[0]["args"], json!({"deviceName": DEVICE}));
    assert_eq!(
        bodies[1]["args"],
        json!({"deviceCode": "secret-device-code"})
    );
    assert_eq!(
        request_paths(&requests),
        ["/api/action", "/api/action", "/api/action", "/api/query"]
    );
    assert_eq!(
        authorizations(&requests),
        [None, None, None, Some("Bearer new".to_string())]
    );
    std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap()).unwrap();
}

#[tokio::test]
async fn a_denied_or_expired_login_fails_and_saves_nothing() {
    for status in ["denied", "expired"] {
        let (base_url, _) = serve(vec![
            reply(OK, None, started(1)),
            reply(OK, None, polled(status)),
        ]);
        let path = scratch(status);

        let error = login(&base_url, &path, DEVICE, false, &mut Vec::new())
            .await
            .unwrap_err();

        assert!(error.to_string().contains("meetcal login"), "{error}");
        assert!(error.to_string().contains(status), "{error}");
        assert_eq!(credentials::load(&path).unwrap(), None);
    }
}

#[tokio::test]
async fn a_refused_start_says_why_plainly() {
    for (status, error, says) in [
        (
            503,
            "sign-in tokens are not configured",
            "MeetCal sign-in is not available right now (sign-in tokens are not configured)",
        ),
        (429, "slow down", "MeetCal is busy right now"),
    ] {
        let (base_url, requests) = serve(vec![
            reply(
                FUNCTION_FAILED,
                None,
                format!(
                    r#"{{"status":"error","errorMessage":"Server Error","errorData":{{"status":{status},"error":"{error}"}}}}"#
                ),
            ),
            reply(OK, None, started(1)),
        ]);
        let path = scratch(&format!("refused-{status}"));

        let error = login(&base_url, &path, DEVICE, false, &mut Vec::new())
            .await
            .unwrap_err();

        assert!(error.to_string().contains(says), "{error}");
        assert!(error.to_string().contains("meetcal login"), "{error}");
        assert_eq!(requests.lock().unwrap().len(), 1);
        assert_eq!(credentials::load(&path).unwrap(), None);
    }
}

#[tokio::test]
async fn a_start_that_is_throttled_is_not_sent_again() {
    let (base_url, requests) = serve(vec![
        reply(RATE_LIMITED, Some("1"), r#"{"error":"rate limited"}"#),
        reply(OK, None, started(1)),
    ]);

    let error = login(
        &base_url,
        &scratch("throttled"),
        DEVICE,
        false,
        &mut Vec::new(),
    )
    .await
    .unwrap_err();

    assert!(
        format!("{error:#}").contains("rate limiting requests right now; try again"),
        "{error:#}"
    );
    assert_eq!(requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn an_approval_whose_answer_was_lost_says_so() {
    let (base_url, requests) = serve(vec![
        reply(OK, None, started(1)),
        reply(OK, None, polled("collected")),
        reply(OK, None, polled("expired")),
    ]);
    let path = scratch("collected");

    let error = login(&base_url, &path, DEVICE, false, &mut Vec::new())
        .await
        .unwrap_err();

    assert_eq!(
        error.to_string(),
        "This login was approved, but its answer was lost on the way. Run `meetcal login` again."
    );
    // The login stops at once rather than polling on into "expired".
    assert_eq!(requests.lock().unwrap().len(), 2);
    assert_eq!(credentials::load(&path).unwrap(), None);
}

#[tokio::test]
async fn a_poll_that_fails_is_not_resent_but_polled_again_later() {
    let (base_url, requests) = serve(vec![
        reply(OK, None, started(1)),
        reply(UNAVAILABLE, None, ""),
        reply(OK, None, approved("new")),
        reply(OK, None, SUBSCRIBED),
    ]);
    let path = scratch("poll-failed");

    login(&base_url, &path, DEVICE, false, &mut Vec::new())
        .await
        .unwrap();

    assert_eq!(
        credentials::load(&path).unwrap(),
        Some(saved("new", &base_url))
    );
    assert_eq!(requests.lock().unwrap().len(), 4);
    std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap()).unwrap();
}

#[tokio::test]
async fn logging_in_again_replaces_and_ends_the_old_login() {
    let (base_url, requests) = serve(vec![
        reply(OK, None, started(1)),
        reply(OK, None, approved("new")),
        reply(OK, None, REVOKED),
        reply(FUNCTION_FAILED, None, NOT_SUBSCRIBED),
        reply(OK, None, refreshed(false)),
    ]);
    let path = scratch("again");
    credentials::save(&path, &saved("old", &base_url)).unwrap();
    let mut out = Vec::new();

    login(&base_url, &path, DEVICE, false, &mut out)
        .await
        .unwrap();

    assert_eq!(
        credentials::load(&path).unwrap(),
        Some(saved("new", &base_url))
    );
    let printed = String::from_utf8(out).unwrap();
    assert!(printed.contains("already logged in"), "{printed}");
    assert!(
        printed.contains("no active MeetCal subscription"),
        "{printed}"
    );
    assert_eq!(
        request_paths(&requests),
        [
            "/api/action",
            "/api/action",
            "/api/mutation",
            "/api/query",
            "/api/action"
        ]
    );
    let bodies = request_bodies(&requests);
    assert_eq!(bodies[2]["path"], "apiTokens:revoke");
    assert_eq!(bodies[2]["args"], json!({}));
    assert_eq!(bodies[4]["path"], "entitlements:refresh");
    assert_eq!(bodies[4]["args"], json!({}));
    assert_eq!(
        authorizations(&requests),
        [
            None,
            None,
            Some("Bearer old".to_string()),
            Some("Bearer new".to_string()),
            Some("Bearer new".to_string())
        ]
    );
    std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap()).unwrap();
}

#[tokio::test]
async fn a_subscription_convex_has_not_heard_of_is_refreshed_after_login() {
    let (base_url, requests) = serve(vec![
        reply(OK, None, started(1)),
        reply(OK, None, approved("new")),
        reply(FUNCTION_FAILED, None, NOT_SUBSCRIBED),
        reply(OK, None, refreshed(true)),
        reply(OK, None, SUBSCRIBED),
    ]);
    let path = scratch("refreshed");
    let mut out = Vec::new();

    login(&base_url, &path, DEVICE, false, &mut out)
        .await
        .unwrap();

    let printed = String::from_utf8(out).unwrap();
    assert!(printed.contains("subscription is active"), "{printed}");
    assert_eq!(
        request_bodies(&requests)
            .iter()
            .map(|body| body["path"].clone())
            .collect::<Vec<_>>(),
        [
            json!("deviceLogin:start"),
            json!("deviceLogin:poll"),
            json!("accessPass:pass"),
            json!("entitlements:refresh"),
            json!("accessPass:pass"),
        ]
    );
    assert_eq!(
        authorizations(&requests)[2..],
        [
            Some("Bearer new".to_string()),
            Some("Bearer new".to_string()),
            Some("Bearer new".to_string())
        ]
    );
    std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap()).unwrap();
}

#[tokio::test]
async fn logout_ends_the_token_and_deletes_the_login() {
    let (base_url, requests) = serve(vec![reply(OK, None, REVOKED)]);
    let path = scratch("logout");
    credentials::save(&path, &saved("jwt", &base_url)).unwrap();
    let mut out = Vec::new();

    logout(&path, &mut out).await.unwrap();

    assert_eq!(credentials::load(&path).unwrap(), None);
    assert_eq!(String::from_utf8(out).unwrap(), "Logged out.\n");
    assert_eq!(request_paths(&requests), ["/api/mutation"]);
    assert_eq!(authorizations(&requests), [Some("Bearer jwt".to_string())]);

    let mut out = Vec::new();
    logout(&path, &mut out).await.unwrap();
    assert_eq!(String::from_utf8(out).unwrap(), "You are not logged in.\n");
}

#[tokio::test]
async fn logout_deletes_the_login_when_meetcal_cannot_be_reached() {
    let path = scratch("offline");
    credentials::save(&path, &saved("jwt", "http://127.0.0.1:1")).unwrap();
    let mut out = Vec::new();

    logout(&path, &mut out).await.unwrap();

    assert_eq!(credentials::load(&path).unwrap(), None);
    let printed = String::from_utf8(out).unwrap();
    assert!(printed.contains("could not be told"), "{printed}");
}

#[test]
fn login_and_logout_take_no_arguments_and_explain_themselves() {
    for command in ["login", "logout"] {
        let help = Cli::command()
            .try_get_matches_from_mut(["meetcal", command, "--help"])
            .unwrap_err()
            .to_string();
        assert!(help.contains(&format!("meetcal {command}")), "{help}");
        assert!(
            Cli::command()
                .try_get_matches_from_mut(["meetcal", command, "extra"])
                .is_err()
        );
    }
    let help = Cli::command()
        .try_get_matches_from_mut(["meetcal", "login", "--help"])
        .unwrap_err()
        .to_string();
    for expected in ["SSH", "subscription", "credentials.json"] {
        assert!(help.contains(expected), "missing {expected:?}");
    }
}
