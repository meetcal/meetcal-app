//! `meetcal login` and `meetcal logout`: a device-code login (`convex/deviceLogin.ts`). The CLI
//! shows a code and a link; the user approves it on any signed-in device (a phone will do), so it
//! works over SSH, on a server and for agents, with no browser and no prompt on this machine. The
//! token it gets is saved by `utils::credentials`, and premium reads trade it for the access pass
//! (`utils::access`).

use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow, bail};
use clap::Parser;
use serde_json::json;

use crate::utils::access::{self, NoPass};
use crate::utils::backend::{self, Endpoint, FunctionError, functions};
use crate::utils::credentials::{self, Credentials};
use crate::utils::device_login::{self, PollAnswer, Poller, Started, Step};

/// Log in to MeetCal, so commands can read subscriber data.
///
/// Prints a link, a code and a QR code: open the link on any device signed in to MeetCal (your
/// phone, say), check the code, and approve. Nothing opens or asks on this machine, so it works
/// over SSH, on a server, or for an AI agent. The login lasts 90 days and is saved in
/// ~/.config/meetcal/credentials.json ($XDG_CONFIG_HOME/meetcal/ when that is set), readable by
/// you alone. Commands with subscriber data need an active MeetCal subscription.
///
/// Examples:
///   meetcal login
#[derive(Parser)]
#[command(name = "login")]
pub struct LoginArgs {}

/// Log out of MeetCal on this machine: ends the saved login and deletes it.
///
/// Examples:
///   meetcal logout
#[derive(Parser)]
#[command(name = "logout")]
pub struct LogoutArgs {}

pub async fn run_login(_args: LoginArgs) -> Result<()> {
    let path = credentials_path()?;
    let device =
        device_login::device_name(device_login::host_name().as_deref(), std::env::consts::OS);
    let show_qr = std::io::stderr().is_terminal();
    login(
        &backend::convex_url(),
        &path,
        &device,
        show_qr,
        &mut std::io::stderr(),
    )
    .await?;
    Ok(())
}

pub async fn run_logout(_args: LogoutArgs) -> Result<()> {
    logout(&credentials_path()?, &mut std::io::stderr()).await
}

fn credentials_path() -> Result<PathBuf> {
    credentials::default_path().context(
        "Cannot tell where to keep your MeetCal login: set HOME (or XDG_CONFIG_HOME) and try again",
    )
}

/// Logs in on the deployment at `base_url` as `device`, saving the login at `path`. Writes what
/// the user needs to `out` (stderr), with a QR code of the link when `show_qr`. Replaces a login
/// already saved there, and ends its token (best effort).
pub async fn login<W: Write>(
    base_url: &str,
    path: &Path,
    device: &str,
    show_qr: bool,
    out: &mut W,
) -> Result<Credentials> {
    let previous = match credentials::load(path) {
        Ok(previous) => previous,
        Err(error) => {
            writeln!(out, "Note: replacing an unreadable login ({error:#}).")?;
            None
        }
    };
    if let Some(previous) = previous
        .as_ref()
        .filter(|previous| previous.is_for(base_url) && !previous.is_expired(access::now_ms()))
    {
        writeln!(
            out,
            "You are already logged in on this computer (until {}). Logging in again replaces \
             that login.\n",
            local_date(previous.expires_at)
        )?;
    }

    let started: Started = backend::call_function(
        base_url,
        Endpoint::Action,
        functions::START_DEVICE_LOGIN,
        &json!({ "deviceName": device }),
        None,
    )
    .await
    .map_err(start_failure)?;
    started.validate()?;
    let link = device_login::approval_url(&started.verification_url, &started.user_code)?;

    writeln!(
        out,
        "To log in, approve this computer from any device signed in to MeetCal:\n"
    )?;
    writeln!(out, "  1. Open {link}")?;
    if show_qr {
        writeln!(out, "     (or scan the QR code below with your phone)")?;
    }
    writeln!(
        out,
        "  2. Check that it shows the code {}",
        started.user_code
    )?;
    writeln!(out, "  3. Approve \"{device}\"\n")?;
    if show_qr {
        writeln!(out, "{}", device_login::qr_code(link.as_str())?)?;
    }
    writeln!(
        out,
        "Waiting for approval... (the code expires {})",
        expiry(started.expires_at, access::now_ms())
    )?;
    out.flush()?;

    let issued = wait_for_approval(base_url, &started).await?;
    let saved = Credentials {
        token: issued.token,
        token_id: issued.token_id,
        expires_at: issued.expires_at,
        deployment: base_url.trim_end_matches('/').to_string(),
    };
    credentials::save(path, &saved)?;
    writeln!(
        out,
        "Logged in. This computer's login lasts until {} ({}).",
        local_date(saved.expires_at),
        path.display()
    )?;

    if let Some(previous) = previous.filter(|previous| {
        previous.token_id != saved.token_id && !previous.is_expired(access::now_ms())
    }) && let Err(error) = revoke(&previous).await
    {
        writeln!(
            out,
            "Note: could not end the previous login's token ({error:#}); it expires on its own \
             on {}.",
            local_date(previous.expires_at)
        )?;
    }

    match access::fetch_pass(base_url, &saved.token).await {
        Ok(_) => writeln!(
            out,
            "Your MeetCal subscription is active: commands read subscriber data with it."
        )?,
        Err(NoPass::NotSubscribed) => writeln!(
            out,
            "This account has no active MeetCal subscription, which commands with subscriber \
             data will need. Subscribe in the MeetCal app."
        )?,
        Err(_) => {}
    }
    Ok(saved)
}

/// What to tell the user when `deviceLogin:start` fails: sign-in switched off on the server
/// (503), or busy (429), are said plainly; anything else keeps its cause.
fn start_failure(error: anyhow::Error) -> anyhow::Error {
    let failed = error
        .chain()
        .find_map(|cause| cause.downcast_ref::<FunctionError>());
    match failed.and_then(|failed| failed.status.map(|status| (status, &failed.reason))) {
        Some((503, reason)) => anyhow!(
            "MeetCal sign-in is not available right now ({reason}). Try `meetcal login` again \
             later."
        ),
        Some((429, _)) => {
            anyhow!("MeetCal is busy right now. Try `meetcal login` again in a few minutes.")
        }
        _ => error.context("Could not start a MeetCal login"),
    }
}

/// Polls the started login until it is approved, denied or expired.
async fn wait_for_approval(base_url: &str, started: &Started) -> Result<device_login::Issued> {
    let mut poller = Poller::new(started);
    let mut wait = poller.interval();
    loop {
        tokio::time::sleep(wait).await;
        let answer = backend::call_function::<PollAnswer>(
            base_url,
            Endpoint::Action,
            functions::POLL_DEVICE_LOGIN,
            &json!({ "deviceCode": started.device_code }),
            None,
        )
        .await
        .map_err(|error| format!("{error:#}"));
        match poller.after(answer, access::now_ms()) {
            Step::Wait(next) => wait = next,
            Step::Approved(issued) => return Ok(issued),
            Step::Failed(failure) => bail!(failure.message()),
        }
    }
}

/// Ends `login`'s token on the deployment that issued it.
async fn revoke(login: &Credentials) -> Result<()> {
    backend::call_function::<serde_json::Value>(
        &login.deployment,
        Endpoint::Mutation,
        functions::REVOKE_TOKEN,
        &json!({}),
        Some(&login.token),
    )
    .await
    .map(|_| ())
}

/// Ends the login saved at `path` and deletes it. The token is ended on the server when it can
/// be; the file goes either way.
pub async fn logout<W: Write>(path: &Path, out: &mut W) -> Result<()> {
    let saved = match credentials::load(path) {
        Ok(Some(saved)) => saved,
        Ok(None) => {
            writeln!(out, "You are not logged in.")?;
            return Ok(());
        }
        Err(error) => {
            credentials::delete(path)?;
            writeln!(out, "Logged out: deleted an unreadable login ({error:#}).")?;
            return Ok(());
        }
    };
    let revoked = if saved.is_expired(access::now_ms()) {
        Ok(())
    } else {
        revoke(&saved).await
    };
    credentials::delete(path)?;
    match revoked {
        Ok(()) => writeln!(out, "Logged out.")?,
        Err(error) => writeln!(
            out,
            "Logged out on this computer, but MeetCal could not be told ({error:#}); the token \
             stops working on its own on {}.",
            local_date(saved.expires_at)
        )?,
    }
    Ok(())
}

/// An epoch-ms instant as a local date, `2027-01-11`.
fn local_date(epoch_ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(epoch_ms)
        .map(|at| {
            at.with_timezone(&chrono::Local)
                .format("%Y-%m-%d")
                .to_string()
        })
        .unwrap_or_else(|| "an unknown date".to_string())
}

/// When a code expiring at `expires_at` does, from `now_ms`: `in 10 minutes, at 14:32`.
fn expiry(expires_at: i64, now_ms: i64) -> String {
    let minutes = ((expires_at - now_ms).max(0) as u64).div_ceil(60_000);
    let at = chrono::DateTime::from_timestamp_millis(expires_at)
        .map(|at| {
            at.with_timezone(&chrono::Local)
                .format(", at %H:%M")
                .to_string()
        })
        .unwrap_or_default();
    match minutes {
        1 => format!("in 1 minute{at}"),
        minutes => format!("in {minutes} minutes{at}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expiry_counts_whole_minutes_up() {
        assert!(expiry(600_000, 0).starts_with("in 10 minutes, at "));
        assert!(expiry(60_000, 1).starts_with("in 1 minute, at "));
        assert!(expiry(0, 5_000).starts_with("in 0 minutes"));
    }

    #[test]
    fn dates_are_calendar_dates() {
        let date = local_date(1_800_000_000_000);
        assert_eq!(date.len(), 10, "{date}");
        assert_eq!(local_date(i64::MAX), "an unknown date");
    }
}
