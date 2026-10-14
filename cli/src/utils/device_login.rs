//! The device-code login `meetcal login` runs (`convex/deviceLogin.ts`), free of I/O: the answers
//! of `deviceLogin:start` and `deviceLogin:poll`, the polling policy, the device's name, the
//! approval link and its QR code.

use std::time::Duration;

use anyhow::{Context, Result, ensure};
use qrcode::{Color, QrCode};
use reqwest::Url;
use serde::Deserialize;

use crate::utils::backend::whole_number;

/// Longest device name the server keeps.
pub const MAX_DEVICE_NAME_CHARS: usize = 64;

/// Shortest wait between polls, whatever `interval` the server sends.
pub const MIN_POLL_INTERVAL: Duration = Duration::from_secs(1);

/// Longest wait between polls, so a bad `interval` cannot stall the login.
pub const MAX_POLL_INTERVAL: Duration = Duration::from_secs(60);

/// What `slow_down` adds to the interval (RFC 8628's five seconds).
pub const SLOW_DOWN_STEP: Duration = Duration::from_secs(5);

/// How long past the code's expiry the CLI keeps polling, for clocks that disagree, before it
/// gives up on its own.
pub const EXPIRY_GRACE_MS: i64 = 30_000;

/// Polls in a row that may fail (a dropped connection, a timeout) before the login gives up.
pub const MAX_POLL_FAILURES: u32 = 5;

/// `deviceLogin:start`'s answer.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    /// The CLI's secret: polls send it, nothing shows it.
    pub device_code: String,
    /// What the user approves: `ABCD-EFGH`.
    pub user_code: String,
    /// Where the user approves it (`https://meetcal.app/link` on production).
    pub verification_url: String,
    /// When the code expires (epoch ms).
    #[serde(deserialize_with = "whole_number")]
    pub expires_at: i64,
    /// Seconds between polls.
    #[serde(deserialize_with = "whole_number")]
    pub interval: i64,
}

impl Started {
    /// Checks the answer is usable: a code to show and to poll with, and a link that parses.
    pub fn validate(&self) -> Result<()> {
        ensure!(
            !self.device_code.trim().is_empty() && !self.user_code.trim().is_empty(),
            "MeetCal started a login without a code"
        );
        approval_url(&self.verification_url, &self.user_code)?;
        Ok(())
    }
}

/// The token an approved login issues.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Issued {
    pub token: String,
    pub token_id: String,
    /// When the token expires (epoch ms).
    #[serde(deserialize_with = "whole_number")]
    pub expires_at: i64,
}

/// `deviceLogin:poll`'s answer.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PollAnswer {
    Pending,
    SlowDown,
    Denied,
    Expired,
    Approved(Issued),
}

/// Why a login ended without a token.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LoginFailure {
    Denied,
    Expired,
    /// Polling failed `MAX_POLL_FAILURES` times in a row; the last error.
    Unreachable(String),
}

impl LoginFailure {
    pub fn message(&self) -> String {
        match self {
            LoginFailure::Denied => {
                "The login was denied. Run `meetcal login` to try again.".to_string()
            }
            LoginFailure::Expired => "The code expired before it was approved. Run `meetcal \
                                      login` to get a new one."
                .to_string(),
            LoginFailure::Unreachable(reason) => format!(
                "Lost touch with MeetCal while waiting for approval ({reason}). Run `meetcal \
                 login` to try again."
            ),
        }
    }
}

/// What the login does after a poll.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Step {
    /// Wait this long, then poll again.
    Wait(Duration),
    Approved(Issued),
    Failed(LoginFailure),
}

/// The polling policy for one login: the interval (grown by `slow_down`), the deadline, and the
/// failures in a row.
#[derive(Clone, Debug)]
pub struct Poller {
    interval: Duration,
    deadline_ms: i64,
    failures: u32,
}

impl Poller {
    pub fn new(started: &Started) -> Self {
        Self {
            interval: Duration::from_secs(started.interval.max(0).unsigned_abs())
                .clamp(MIN_POLL_INTERVAL, MAX_POLL_INTERVAL),
            deadline_ms: started.expires_at.saturating_add(EXPIRY_GRACE_MS),
            failures: 0,
        }
    }

    /// The wait before the first poll.
    pub fn interval(&self) -> Duration {
        self.interval
    }

    /// The step after a poll that answered `answer` (or failed with its error) at `now_ms`.
    pub fn after(&mut self, answer: Result<PollAnswer, String>, now_ms: i64) -> Step {
        match answer {
            Ok(PollAnswer::Approved(issued)) => return Step::Approved(issued),
            Ok(PollAnswer::Denied) => return Step::Failed(LoginFailure::Denied),
            Ok(PollAnswer::Expired) => return Step::Failed(LoginFailure::Expired),
            Ok(PollAnswer::Pending) => self.failures = 0,
            Ok(PollAnswer::SlowDown) => {
                self.failures = 0;
                self.interval = (self.interval + SLOW_DOWN_STEP).min(MAX_POLL_INTERVAL);
            }
            Err(reason) => {
                self.failures += 1;
                if self.failures >= MAX_POLL_FAILURES {
                    return Step::Failed(LoginFailure::Unreachable(reason));
                }
            }
        }
        if now_ms >= self.deadline_ms {
            return Step::Failed(LoginFailure::Expired);
        }
        Step::Wait(self.interval)
    }
}

/// The name the approval page shows for this device: `meetcal CLI on <host> (<os>)`, at most
/// `MAX_DEVICE_NAME_CHARS` characters.
pub fn device_name(host: Option<&str>, os: &str) -> String {
    let os = match os {
        "macos" => "macOS",
        "linux" => "Linux",
        "windows" => "Windows",
        "freebsd" => "FreeBSD",
        other => other,
    };
    let name = match host.map(str::trim).filter(|host| !host.is_empty()) {
        Some(host) => format!("meetcal CLI on {host} ({os})"),
        None => format!("meetcal CLI ({os})"),
    };
    name.chars().take(MAX_DEVICE_NAME_CHARS).collect::<String>()
}

/// The link the user opens: `verification_url` with `code=<user_code>` added to its query.
pub fn approval_url(verification_url: &str, user_code: &str) -> Result<Url> {
    let mut url = Url::parse(verification_url)
        .with_context(|| format!("MeetCal sent an unusable login link: {verification_url}"))?;
    ensure!(
        matches!(url.scheme(), "https" | "http"),
        "MeetCal sent an unusable login link: {verification_url}"
    );
    url.query_pairs_mut().append_pair("code", user_code);
    Ok(url)
}

/// Modules of light margin around the QR code. The spec asks for four; two scan fine on a screen
/// and keep the code short.
const QR_QUIET_ZONE: usize = 2;

/// `text` as a QR code drawn with half blocks, two module rows per line, in black on white
/// (ANSI colours), so it scans on light and dark terminals alike.
pub fn qr_code(text: &str) -> Result<String> {
    let code = QrCode::new(text.as_bytes()).context("Failed to draw the QR code")?;
    let width = code.width();
    let colors = code.to_colors();
    let size = width + 2 * QR_QUIET_ZONE;
    let dark = |row: usize, column: usize| {
        let inside = |at: usize| (QR_QUIET_ZONE..QR_QUIET_ZONE + width).contains(&at);
        inside(row)
            && inside(column)
            && colors[(row - QR_QUIET_ZONE) * width + column - QR_QUIET_ZONE] == Color::Dark
    };
    let mut drawn = String::new();
    for row in (0..size).step_by(2) {
        drawn.push_str("\x1b[30;107m");
        for column in 0..size {
            drawn.push(match (dark(row, column), dark(row + 1, column)) {
                (true, true) => '█',
                (true, false) => '▀',
                (false, true) => '▄',
                (false, false) => ' ',
            });
        }
        drawn.push_str("\x1b[0m\n");
    }
    Ok(drawn)
}

/// This machine's name, for [`device_name`]: the kernel's on Linux, else `hostname`'s, else the
/// environment's. `None` when none is known.
pub fn host_name() -> Option<String> {
    let non_empty = |name: String| {
        let name = name.trim().to_string();
        (!name.is_empty()).then_some(name)
    };
    std::fs::read_to_string("/proc/sys/kernel/hostname")
        .ok()
        .and_then(non_empty)
        .or_else(|| {
            std::process::Command::new("hostname")
                .output()
                .ok()
                .filter(|output| output.status.success())
                .and_then(|output| String::from_utf8(output.stdout).ok())
                .and_then(non_empty)
        })
        .or_else(|| {
            ["HOSTNAME", "COMPUTERNAME"]
                .into_iter()
                .find_map(|name| std::env::var(name).ok().and_then(non_empty))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn started(interval: i64) -> Started {
        Started {
            device_code: "d".repeat(64),
            user_code: "BCDF-GHJK".to_string(),
            verification_url: "https://meetcal.app/link".to_string(),
            expires_at: 600_000,
            interval,
        }
    }

    #[test]
    fn start_answers_parse() {
        let answer: Started = serde_json::from_value(json!({
            "deviceCode": "abc123",
            "userCode": "BCDF-GHJK",
            "verificationUrl": "https://meetcal.app/link",
            "expiresAt": 1_800_000_600_000_i64,
            "interval": 5,
        }))
        .unwrap();
        assert_eq!(answer.device_code, "abc123");
        assert_eq!(answer.user_code, "BCDF-GHJK");
        assert_eq!(answer.expires_at, 1_800_000_600_000);
        assert_eq!(answer.interval, 5);
        answer.validate().unwrap();

        // Convex's HTTP API writes numbers as floats.
        let floats: Started = serde_json::from_value(json!({
            "deviceCode": "abc123",
            "userCode": "BCDF-GHJK",
            "verificationUrl": "https://meetcal.app/link",
            "expiresAt": 1_791_948_423_574.0,
            "interval": 5.0,
        }))
        .unwrap();
        assert_eq!(floats.expires_at, 1_791_948_423_574);
        assert_eq!(floats.interval, 5);
        assert_eq!(Poller::new(&floats).interval(), Duration::from_secs(5));

        for broken in [
            json!({"deviceCode": "abc", "userCode": "BCDF-GHJK", "verificationUrl": "https://x", "expiresAt": 1}),
            json!({"deviceCode": "abc", "userCode": "BCDF-GHJK", "verificationUrl": "https://x", "expiresAt": "soon", "interval": 5}),
        ] {
            assert!(serde_json::from_value::<Started>(broken).is_err());
        }
        let mut blank = started(5);
        blank.user_code = " ".to_string();
        assert!(blank.validate().is_err());
        let mut bad_link = started(5);
        bad_link.verification_url = "javascript:alert(1)".to_string();
        assert!(bad_link.validate().is_err());
    }

    #[test]
    fn poll_answers_parse() {
        let parse = |value| serde_json::from_value::<PollAnswer>(value);
        assert_eq!(
            parse(json!({"status": "pending"})).unwrap(),
            PollAnswer::Pending
        );
        assert_eq!(
            parse(json!({"status": "slow_down"})).unwrap(),
            PollAnswer::SlowDown
        );
        assert_eq!(
            parse(json!({"status": "denied"})).unwrap(),
            PollAnswer::Denied
        );
        assert_eq!(
            parse(json!({"status": "expired"})).unwrap(),
            PollAnswer::Expired
        );
        assert_eq!(
            parse(json!({"status": "approved", "token": "jwt", "tokenId": "tid", "expiresAt": 9_000_i64}))
                .unwrap(),
            PollAnswer::Approved(Issued {
                token: "jwt".to_string(),
                token_id: "tid".to_string(),
                expires_at: 9_000,
            })
        );
        assert_eq!(
            parse(json!({"status": "approved", "token": "jwt", "tokenId": "tid", "expiresAt": 1_799_724_241_867.0}))
                .unwrap(),
            PollAnswer::Approved(Issued {
                token: "jwt".to_string(),
                token_id: "tid".to_string(),
                expires_at: 1_799_724_241_867,
            })
        );
        for broken in [
            json!({"status": "approved", "token": "jwt"}),
            json!({"status": "waiting"}),
            json!({}),
        ] {
            assert!(parse(broken.clone()).is_err(), "{broken}");
        }
    }

    #[test]
    fn polling_waits_the_interval_and_slows_down_when_asked() {
        let mut poller = Poller::new(&started(5));
        assert_eq!(poller.interval(), Duration::from_secs(5));
        assert_eq!(
            poller.after(Ok(PollAnswer::Pending), 0),
            Step::Wait(Duration::from_secs(5))
        );
        assert_eq!(
            poller.after(Ok(PollAnswer::SlowDown), 0),
            Step::Wait(Duration::from_secs(10))
        );
        assert_eq!(
            poller.after(Ok(PollAnswer::Pending), 0),
            Step::Wait(Duration::from_secs(10))
        );
        assert_eq!(
            poller.after(Ok(PollAnswer::SlowDown), 0),
            Step::Wait(Duration::from_secs(15))
        );
    }

    #[test]
    fn the_interval_stays_within_bounds() {
        assert_eq!(Poller::new(&started(0)).interval(), MIN_POLL_INTERVAL);
        let mut poller = Poller::new(&started(3600));
        assert_eq!(poller.interval(), MAX_POLL_INTERVAL);
        assert_eq!(
            poller.after(Ok(PollAnswer::SlowDown), 0),
            Step::Wait(MAX_POLL_INTERVAL)
        );
    }

    #[test]
    fn polling_ends_on_approval_denial_or_expiry() {
        let issued = Issued {
            token: "jwt".to_string(),
            token_id: "tid".to_string(),
            expires_at: 1,
        };
        let mut poller = Poller::new(&started(5));
        assert_eq!(
            poller.after(Ok(PollAnswer::Approved(issued.clone())), 0),
            Step::Approved(issued)
        );
        assert_eq!(
            poller.after(Ok(PollAnswer::Denied), 0),
            Step::Failed(LoginFailure::Denied)
        );
        assert_eq!(
            poller.after(Ok(PollAnswer::Expired), 0),
            Step::Failed(LoginFailure::Expired)
        );
        // A server that keeps answering pending past the code's expiry is given up on.
        let deadline = started(5).expires_at + EXPIRY_GRACE_MS;
        assert_eq!(
            poller.after(Ok(PollAnswer::Pending), deadline - 1),
            Step::Wait(Duration::from_secs(5))
        );
        assert_eq!(
            poller.after(Ok(PollAnswer::Pending), deadline),
            Step::Failed(LoginFailure::Expired)
        );
    }

    #[test]
    fn polling_survives_a_few_failures_in_a_row() {
        let mut poller = Poller::new(&started(5));
        for _ in 1..MAX_POLL_FAILURES {
            assert_eq!(
                poller.after(Err("timed out".to_string()), 0),
                Step::Wait(Duration::from_secs(5))
            );
        }
        // An answer resets the count.
        assert_eq!(
            poller.after(Ok(PollAnswer::Pending), 0),
            Step::Wait(Duration::from_secs(5))
        );
        for _ in 1..MAX_POLL_FAILURES {
            poller.after(Err("timed out".to_string()), 0);
        }
        assert_eq!(
            poller.after(Err("timed out".to_string()), 0),
            Step::Failed(LoginFailure::Unreachable("timed out".to_string()))
        );
    }

    #[test]
    fn failures_tell_the_user_what_to_do() {
        for failure in [
            LoginFailure::Denied,
            LoginFailure::Expired,
            LoginFailure::Unreachable("x".to_string()),
        ] {
            assert!(failure.message().contains("meetcal login"), "{failure:?}");
        }
    }

    #[test]
    fn the_device_name_names_the_host_and_os() {
        assert_eq!(
            device_name(Some("studio.local\n"), "macos"),
            "meetcal CLI on studio.local (macOS)"
        );
        assert_eq!(device_name(None, "linux"), "meetcal CLI (Linux)");
        assert_eq!(device_name(Some("  "), "haiku"), "meetcal CLI (haiku)");
        let long = device_name(Some(&"é".repeat(100)), "linux");
        assert_eq!(long.chars().count(), MAX_DEVICE_NAME_CHARS);
        assert!(long.starts_with("meetcal CLI on éé"));
    }

    #[test]
    fn the_approval_url_carries_the_code() {
        assert_eq!(
            approval_url("https://meetcal.app/link", "BCDF-GHJK")
                .unwrap()
                .as_str(),
            "https://meetcal.app/link?code=BCDF-GHJK"
        );
        assert_eq!(
            approval_url("https://dev.meetcal.app/link?from=cli", "A B&C")
                .unwrap()
                .as_str(),
            "https://dev.meetcal.app/link?from=cli&code=A+B%26C"
        );
        assert!(approval_url("not a url", "BCDF-GHJK").is_err());
        assert!(approval_url("file:///etc/passwd", "BCDF-GHJK").is_err());
    }

    #[test]
    fn the_qr_code_is_black_on_white_half_blocks() {
        let url = "https://meetcal.app/link?code=BCDF-GHJK";
        let drawn = qr_code(url).unwrap();
        let width = QrCode::new(url.as_bytes()).unwrap().width();
        let size = width + 2 * QR_QUIET_ZONE;
        let lines: Vec<&str> = drawn.lines().collect();
        assert_eq!(lines.len(), size.div_ceil(2));
        for line in &lines {
            let cells = line
                .strip_prefix("\x1b[30;107m")
                .and_then(|line| line.strip_suffix("\x1b[0m"))
                .expect("each line is coloured and reset");
            assert_eq!(cells.chars().count(), size);
            assert!(cells.chars().all(|cell| " ▀▄█".contains(cell)));
        }
        // The quiet zone is light; the next line starts with the top finder pattern's upper edge.
        assert!(lines[0].contains(&" ".repeat(size)));
        assert!(lines[1].contains("  █▀▀▀▀▀█"), "{:?}", lines[1]);
    }
}
