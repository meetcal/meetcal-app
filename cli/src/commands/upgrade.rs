//! `meetcal upgrade`: installs the newest release the way this copy was installed
//! (`utils::upgrade`), or with `--check` only says whether one is out.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use clap::Parser;

use crate::utils::backend;
use crate::utils::releases::{self, CHECKSUMS_ASSET, Release, Version};
use crate::utils::upgrade::{self, Install, MAX_DOWNLOAD_BYTES, NotWritable};

/// Time allowed for each release download, longer than a data read's: an archive is megabytes.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(300);

/// `--check`'s exit code when it could not find out (offline, GitHub refused): 1 means a newer
/// release is out, so a failure must not look like one.
pub const CHECK_FAILED: i32 = 2;

/// Upgrade meetcal to its newest release.
///
/// Installed with Homebrew, it runs `brew update` and `brew upgrade meetcal/tap/meetcal`; with Cargo, `cargo
/// install` of the release's tag. Otherwise it downloads the release for this machine from GitHub,
/// checks it against the release's SHA256SUMS, and replaces this binary. It never asks for more
/// rights: where it cannot write, it says what to run.
///
/// Other commands say once a day when a newer release is out, on a terminal only. Set
/// MEETCAL_NO_UPDATE_CHECK=1 to turn that off.
#[derive(Parser)]
#[command(
    name = "upgrade",
    after_help = r#"Examples:
  meetcal upgrade
  meetcal upgrade --check"#
)]
pub struct UpgradeArgs {
    /// Only say whether a newer release is out: exits 0 when this is the newest, 1 when not, 2
    /// when it cannot tell
    #[arg(long)]
    pub check: bool,
}

pub async fn run(args: UpgradeArgs) -> Result<()> {
    let client = backend::client()?;
    let current = Version::current();
    let found = releases::fetch_newest(client)
        .await
        .and_then(|release| release.context("GitHub lists no release of the CLI"));
    let release = match found {
        Ok(release) => release,
        Err(error) if args.check => {
            eprintln!("Error: {error:?}");
            std::process::exit(CHECK_FAILED);
        }
        Err(error) => return Err(error),
    };
    let mut err = std::io::stderr();

    if !releases::is_newer(release.version, current) {
        writeln!(err, "meetcal {current} is the newest release.")?;
        return Ok(());
    }
    if args.check {
        writeln!(
            err,
            "meetcal {} is out (you have {current}): run `meetcal upgrade`",
            release.version
        )?;
        std::process::exit(1);
    }

    writeln!(err, "Upgrading meetcal {current} to {}.", release.version)?;
    let exe = std::env::current_exe()
        .and_then(|exe| exe.canonicalize())
        .context("Cannot tell where this meetcal binary is")?;
    let cargo_bin = upgrade::cargo_bin(
        std::env::var_os("CARGO_HOME").map(PathBuf::from).as_deref(),
        std::env::var_os("HOME").map(PathBuf::from).as_deref(),
    )
    .and_then(|bin| bin.canonicalize().ok());

    match upgrade::detect(&exe, cargo_bin.as_deref()) {
        Install::Homebrew { prefix } => {
            // Homebrew refreshes its taps at most once a day on its own: without the update,
            // `brew upgrade` can answer "already installed" while the tap has the release.
            let (program, commands) = upgrade::homebrew_commands(&prefix);
            for args in &commands {
                run_installer(&program, args, "Homebrew", &mut err)?;
            }
            let linked = prefix.join("bin").join(upgrade::BINARY_NAME);
            confirm_installed(&linked, release.version, "Homebrew", &mut err)
        }
        Install::Cargo => {
            let (program, args) = upgrade::cargo_command(release.version);
            run_installer(&program, &args, "Cargo", &mut err)?;
            confirm_installed(&exe, release.version, "Cargo", &mut err)
        }
        Install::Binary { path } => install_release(client, &release, &path, &mut err).await,
    }
}

/// Runs the package manager that installed meetcal, its output going straight to the terminal.
fn run_installer(
    program: &Path,
    args: &[String],
    manager: &str,
    err: &mut impl Write,
) -> Result<()> {
    let command = format!("{} {}", program.display(), args.join(" "));
    writeln!(err, "{manager} installed meetcal, so running: {command}")?;
    let status = match Command::new(program).args(args).status() {
        Ok(status) => status,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            bail!(
                "{manager} installed meetcal, but {} is not on your PATH. Run: {command}",
                program.display()
            )
        }
        Err(error) => return Err(error).with_context(|| format!("Failed to run {command}")),
    };
    if !status.success() {
        bail!("`{command}` failed ({status})");
    }
    Ok(())
}

/// Fails unless the binary a package manager just installed at `path` is `expected`: a manager
/// that found nothing newer still exits 0.
fn confirm_installed(
    path: &Path,
    expected: Version,
    manager: &str,
    err: &mut impl Write,
) -> Result<()> {
    match upgrade::reported_version(path) {
        Some(version) if version == expected => {
            writeln!(err, "Upgraded to meetcal {expected}.")?;
            Ok(())
        }
        Some(version) => bail!(
            "{manager} still has meetcal {version}, not {expected}. The release may not have reached {manager} yet: try again in a few minutes"
        ),
        None => bail!(
            "{manager} finished, but {} does not report its version",
            path.display()
        ),
    }
}

/// Replaces the binary at `exe` with the release's build for this machine.
async fn install_release(
    client: &reqwest::Client,
    release: &Release,
    exe: &Path,
    err: &mut impl Write,
) -> Result<()> {
    let (os, arch) = (std::env::consts::OS, std::env::consts::ARCH);
    let Some(artifact) = upgrade::artifact(os, arch) else {
        let (_, args) = upgrade::cargo_command(release.version);
        bail!(
            "No release binary is built for this machine ({os} {arch}). Build it with Cargo: cargo {}",
            args.join(" ")
        );
    };
    let archive_name = upgrade::archive_name(artifact);
    let release_page = format!(
        "https://github.com/meetcal/meetcal-app/releases/tag/{}",
        release.version.tag()
    );
    let (Some(archive_url), Some(sums_url)) = (
        release.asset_url(&archive_name),
        release.asset_url(CHECKSUMS_ASSET),
    ) else {
        bail!(
            "The {} release has no {archive_name} or no {CHECKSUMS_ASSET} to check it with. Download it from {release_page}",
            release.version
        );
    };

    writeln!(err, "Downloading {archive_name}.")?;
    let archive = download(client, archive_url).await?;
    let sums = download(client, sums_url).await?;
    let sums = String::from_utf8(sums).context("The release's SHA256SUMS is not text")?;
    upgrade::verify_archive(&archive, &sums, &archive_name)?;
    let binary = upgrade::extract_binary(&archive)?;

    match upgrade::replace_binary(exe, &binary, release.version) {
        Ok(()) => {
            writeln!(
                err,
                "Upgraded to meetcal {} ({}). Changes: https://github.com/meetcal/meetcal-app/blob/master/cli/CHANGELOG.md",
                release.version,
                exe.display()
            )?;
            Ok(())
        }
        Err(error) => match error.downcast_ref::<NotWritable>() {
            Some(not_writable) => bail!(
                "{not_writable}, where meetcal is installed. Run the upgrade with the rights to write there: sudo {} upgrade",
                exe.display()
            ),
            None => Err(error),
        },
    }
}

/// The body at `url`, at most [`MAX_DOWNLOAD_BYTES`].
async fn download(client: &reqwest::Client, url: &str) -> Result<Vec<u8>> {
    let mut response = client
        .get(url)
        .timeout(DOWNLOAD_TIMEOUT)
        .send()
        .await
        .with_context(|| format!("Failed to download {url}"))?;
    let status = response.status();
    if !status.is_success() {
        bail!("Downloading {url} answered {status}");
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_DOWNLOAD_BYTES)
    {
        bail!("{url} is too large to be a CLI release");
    }
    // Read a chunk at a time, so a body with no length stops at the cap rather than after it.
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .with_context(|| format!("Failed to download {url}"))?
    {
        if (body.len() + chunk.len()) as u64 > MAX_DOWNLOAD_BYTES {
            bail!("{url} is too large to be a CLI release");
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}
