//! How `meetcal upgrade` installs a newer release: through Homebrew or Cargo when it was installed
//! by one of them, so their records stay right, or by replacing its own binary with the release
//! archive's after checking the archive against the release's `SHA256SUMS`. No I/O here but the
//! file system; `commands::upgrade` fetches and runs.

use std::fmt;
use std::fs;
use std::io::{ErrorKind, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result, bail};
use flate2::read::GzDecoder;
use sha2::{Digest, Sha256};

use crate::utils::releases::Version;

/// The Homebrew formula, in the tap it is published from (`cli/docs/releasing.md`).
pub const HOMEBREW_FORMULA: &str = "meetcal/tap/meetcal";

/// The repository `cargo install --git` builds from.
pub const GIT_URL: &str = "https://github.com/meetcal/meetcal-app.git";

/// The binary's name, in the release archives and on disk.
pub const BINARY_NAME: &str = "meetcal";

/// Largest archive or binary `upgrade` accepts. A release binary is a few megabytes; anything
/// near this is not one.
pub const MAX_DOWNLOAD_BYTES: u64 = 100 * 1024 * 1024;

/// How this copy of the CLI was installed, judged by where its binary is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Install {
    /// Under a Homebrew prefix's `Cellar/meetcal/`. `prefix` holds `bin/brew`.
    Homebrew { prefix: PathBuf },
    /// In Cargo's `bin` directory (`cargo install`).
    Cargo,
    /// Anywhere else: an archive unpacked by hand. `path` is the binary to replace.
    Binary { path: PathBuf },
}

/// How the binary at `exe` (with symlinks resolved) was installed. `cargo_bin` is Cargo's `bin`
/// directory (`$CARGO_HOME/bin`, or `~/.cargo/bin`), symlinks resolved, when known.
pub fn detect(exe: &Path, cargo_bin: Option<&Path>) -> Install {
    let components: Vec<Component> = exe.components().collect();
    let cellar = components
        .windows(2)
        .position(|pair| pair[0].as_os_str() == "Cellar" && pair[1].as_os_str() == BINARY_NAME);
    if let Some(index) = cellar {
        let prefix: PathBuf = components[..index].iter().collect();
        return Install::Homebrew { prefix };
    }
    if cargo_bin.is_some_and(|bin| exe.parent() == Some(bin)) {
        return Install::Cargo;
    }
    Install::Binary {
        path: exe.to_path_buf(),
    }
}

/// Cargo's `bin` directory from the environment's `CARGO_HOME` and `HOME`.
pub fn cargo_bin(cargo_home: Option<&Path>, home: Option<&Path>) -> Option<PathBuf> {
    cargo_home
        .filter(|dir| dir.is_absolute())
        .map(Path::to_path_buf)
        .or_else(|| {
            home.filter(|dir| dir.is_absolute())
                .map(|home| home.join(".cargo"))
        })
        .map(|dir| dir.join("bin"))
}

/// The release archive built for `os` and `arch` (`std::env::consts`), if there is one.
pub fn artifact(os: &str, arch: &str) -> Option<&'static str> {
    match (os, arch) {
        ("macos", "aarch64") => Some("darwin-arm64"),
        ("macos", "x86_64") => Some("darwin-x64"),
        ("linux", "aarch64") => Some("linux-arm64"),
        ("linux", "x86_64") => Some("linux-x64"),
        _ => None,
    }
}

/// The archive file name for `artifact`.
pub fn archive_name(artifact: &str) -> String {
    format!("{artifact}.tar.gz")
}

/// The command `upgrade` runs for a Homebrew install.
pub fn homebrew_command(prefix: &Path) -> (PathBuf, Vec<String>) {
    let brew = prefix.join("bin").join("brew");
    let program = if brew.is_file() {
        brew
    } else {
        PathBuf::from("brew")
    };
    (
        program,
        vec!["upgrade".to_string(), HOMEBREW_FORMULA.to_string()],
    )
}

/// The command `upgrade` runs for a Cargo install: the release's tag, with its lockfile.
pub fn cargo_command(version: Version) -> (PathBuf, Vec<String>) {
    let args = [
        "install",
        "--git",
        GIT_URL,
        "--tag",
        &version.tag(),
        "--locked",
        "--force",
        BINARY_NAME,
    ];
    (
        PathBuf::from("cargo"),
        args.iter().map(|arg| arg.to_string()).collect(),
    )
}

/// The SHA-256 `sums` (a `SHA256SUMS` file: `<hex>  <name>` lines, `*<name>` for binary mode)
/// gives for `file`, lowercase.
pub fn expected_sha256(sums: &str, file: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let (hash, name) = line.trim().split_once(char::is_whitespace)?;
        let name = name.trim_start();
        let name = name.strip_prefix('*').unwrap_or(name);
        (name == file && hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()))
            .then(|| hash.to_ascii_lowercase())
    })
}

/// The SHA-256 of `bytes`, lowercase hex.
pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Fails unless `archive` hashes to what `sums` lists for `name`.
pub fn verify_archive(archive: &[u8], sums: &str, name: &str) -> Result<()> {
    let Some(expected) = expected_sha256(sums, name) else {
        bail!(
            "The release's {} lists no checksum for {name}",
            crate::utils::releases::CHECKSUMS_ASSET
        );
    };
    let actual = sha256_hex(archive);
    if actual != expected {
        bail!(
            "{name} does not match its checksum (expected {expected}, got {actual}): not installed"
        );
    }
    Ok(())
}

/// The `meetcal` binary inside a release archive (a gzipped tar holding it at its root).
pub fn extract_binary(archive: &[u8]) -> Result<Vec<u8>> {
    let mut tar = tar::Archive::new(GzDecoder::new(archive));
    for entry in tar
        .entries()
        .context("The release archive is not a gzipped tar")?
    {
        let entry = entry.context("The release archive is damaged")?;
        let is_binary = entry.header().entry_type().is_file()
            && entry
                .path()
                .ok()
                .is_some_and(|path| path.file_name().is_some_and(|name| name == BINARY_NAME));
        if !is_binary {
            continue;
        }
        let mut binary = Vec::new();
        entry
            .take(MAX_DOWNLOAD_BYTES + 1)
            .read_to_end(&mut binary)
            .context("The release archive is damaged")?;
        if binary.len() as u64 > MAX_DOWNLOAD_BYTES {
            bail!("The release archive's binary is too large to be the CLI");
        }
        return Ok(binary);
    }
    bail!("The release archive holds no {BINARY_NAME} binary")
}

/// `upgrade` cannot write the directory the binary is in (a root-owned `/usr/local/bin`, say).
#[derive(Debug)]
pub struct NotWritable {
    pub dir: PathBuf,
}

impl fmt::Display for NotWritable {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Cannot write to {}", self.dir.display())
    }
}

impl std::error::Error for NotWritable {}

/// Replaces the binary at `exe` with `binary`, which must report `expected` as its version:
/// writes it next to `exe`, runs its `--version`, then renames it over `exe`, so a failure at any
/// step leaves the installed binary as it was. A directory it cannot write fails with
/// [`NotWritable`].
pub fn replace_binary(exe: &Path, binary: &[u8], expected: Version) -> Result<()> {
    let dir = exe
        .parent()
        .with_context(|| format!("{} has no parent directory", exe.display()))?;
    let staged = dir.join(format!(".{BINARY_NAME}-upgrade-{}", std::process::id()));
    let _ = fs::remove_file(&staged);

    if let Err(error) = write_executable(&staged, binary) {
        let _ = fs::remove_file(&staged);
        if matches!(
            error.kind(),
            ErrorKind::PermissionDenied | ErrorKind::ReadOnlyFilesystem
        ) {
            return Err(NotWritable {
                dir: dir.to_path_buf(),
            }
            .into());
        }
        return Err(error).with_context(|| format!("Failed to write {}", staged.display()));
    }

    let installed = check_version(&staged, expected).and_then(|()| {
        fs::rename(&staged, exe).with_context(|| format!("Failed to replace {}", exe.display()))
    });
    if installed.is_err() {
        let _ = fs::remove_file(&staged);
    }
    installed
}

fn write_executable(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o755);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

/// Fails unless the binary at `path` runs and prints `meetcal <expected>` for `--version`.
fn check_version(path: &Path, expected: Version) -> Result<()> {
    let output = run_version(path)
        .context("The downloaded binary does not run on this machine: not installed")?;
    let printed = String::from_utf8_lossy(&output.stdout);
    let wanted = format!("{BINARY_NAME} {expected}");
    if !output.status.success() || printed.trim() != wanted {
        bail!(
            "The downloaded binary reported {:?}, not {wanted:?}: not installed",
            printed.trim()
        );
    }
    Ok(())
}

/// Runs `path --version`. A file just written can briefly refuse to run ("text file busy") while
/// a process forked elsewhere in this one still holds it open, so that is retried.
fn run_version(path: &Path) -> std::io::Result<std::process::Output> {
    const TEXT_FILE_BUSY: i32 = 26;
    let mut attempts = 0;
    loop {
        match Command::new(path).arg("--version").output() {
            Err(error) if error.raw_os_error() == Some(TEXT_FILE_BUSY) && attempts < 10 => {
                attempts += 1;
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            result => return result,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn version(text: &str) -> Version {
        Version::parse(text).unwrap()
    }

    #[test]
    fn a_cellar_binary_is_homebrew() {
        for (exe, prefix) in [
            (
                "/opt/homebrew/Cellar/meetcal/3.0.0/bin/meetcal",
                "/opt/homebrew",
            ),
            ("/usr/local/Cellar/meetcal/3.0.0/bin/meetcal", "/usr/local"),
            (
                "/home/linuxbrew/.linuxbrew/Cellar/meetcal/3.0.0/bin/meetcal",
                "/home/linuxbrew/.linuxbrew",
            ),
        ] {
            assert_eq!(
                detect(Path::new(exe), None),
                Install::Homebrew {
                    prefix: PathBuf::from(prefix)
                },
                "{exe}"
            );
        }
    }

    #[test]
    fn another_formulas_cellar_is_not_homebrew() {
        let exe = Path::new("/opt/homebrew/Cellar/other/1.0/libexec/meetcal");
        assert_eq!(
            detect(exe, None),
            Install::Binary {
                path: exe.to_path_buf()
            }
        );
    }

    #[test]
    fn a_binary_in_cargos_bin_is_cargo() {
        let bin = PathBuf::from("/home/me/.cargo/bin");
        assert_eq!(
            detect(Path::new("/home/me/.cargo/bin/meetcal"), Some(&bin)),
            Install::Cargo
        );
        assert_eq!(
            detect(Path::new("/home/me/.local/bin/meetcal"), Some(&bin)),
            Install::Binary {
                path: PathBuf::from("/home/me/.local/bin/meetcal")
            }
        );
    }

    #[test]
    fn cargo_bin_prefers_cargo_home() {
        let home = Path::new("/home/me");
        assert_eq!(
            cargo_bin(Some(Path::new("/opt/cargo")), Some(home)),
            Some(PathBuf::from("/opt/cargo/bin"))
        );
        assert_eq!(
            cargo_bin(None, Some(home)),
            Some(PathBuf::from("/home/me/.cargo/bin"))
        );
        assert_eq!(
            cargo_bin(Some(Path::new("relative")), Some(home)),
            Some(PathBuf::from("/home/me/.cargo/bin"))
        );
        assert_eq!(cargo_bin(None, None), None);
    }

    #[test]
    fn artifacts_match_the_release_matrix() {
        assert_eq!(artifact("macos", "aarch64"), Some("darwin-arm64"));
        assert_eq!(artifact("macos", "x86_64"), Some("darwin-x64"));
        assert_eq!(artifact("linux", "aarch64"), Some("linux-arm64"));
        assert_eq!(artifact("linux", "x86_64"), Some("linux-x64"));
        assert_eq!(artifact("windows", "x86_64"), None);
    }

    #[test]
    fn cargo_installs_the_releases_tag_with_its_lockfile() {
        let (program, args) = cargo_command(version("3.1.0"));
        assert_eq!(program, PathBuf::from("cargo"));
        assert_eq!(
            args.join(" "),
            "install --git https://github.com/meetcal/meetcal-app.git --tag cli-v3.1.0 --locked --force meetcal"
        );
    }

    #[test]
    fn homebrew_upgrades_the_taps_formula() {
        let (program, args) = homebrew_command(Path::new("/nonexistent-prefix"));
        assert_eq!(program, PathBuf::from("brew"));
        assert_eq!(args, ["upgrade", "meetcal/tap/meetcal"]);
    }

    const HASH: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn checksums_are_read_by_file_name() {
        let sums = format!(
            "{}  darwin-arm64.tar.gz\n{HASH} *linux-x64.tar.gz\nnot a line\n",
            "f".repeat(64)
        );
        assert_eq!(
            expected_sha256(&sums, "linux-x64.tar.gz").as_deref(),
            Some(HASH)
        );
        assert_eq!(
            expected_sha256(&sums, "darwin-arm64.tar.gz"),
            Some("f".repeat(64))
        );
        assert_eq!(expected_sha256(&sums, "linux-arm64.tar.gz"), None);
        assert_eq!(
            expected_sha256("short  linux-x64.tar.gz", "linux-x64.tar.gz"),
            None
        );
    }

    #[test]
    fn an_archive_must_match_its_checksum() {
        let archive = b"archive bytes";
        let sums = format!("{}  linux-x64.tar.gz\n", sha256_hex(archive));
        verify_archive(archive, &sums, "linux-x64.tar.gz").unwrap();

        let error = verify_archive(b"other bytes", &sums, "linux-x64.tar.gz").unwrap_err();
        assert!(
            error.to_string().contains("does not match its checksum"),
            "{error}"
        );
        let error = verify_archive(archive, &sums, "darwin-x64.tar.gz").unwrap_err();
        assert!(error.to_string().contains("no checksum"), "{error}");
    }

    #[test]
    fn sha256_is_lowercase_hex() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    pub(crate) fn tar_gz(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
            Vec::new(),
            flate2::Compression::default(),
        ));
        for (name, bytes) in files {
            let mut header = tar::Header::new_gnu();
            header.set_size(bytes.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            builder.append_data(&mut header, name, *bytes).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap()
    }

    #[test]
    fn the_binary_is_found_in_the_archive() {
        let archive = tar_gz(&[("README", b"readme"), ("meetcal", b"binary")]);
        assert_eq!(extract_binary(&archive).unwrap(), b"binary");
    }

    #[test]
    fn an_archive_without_the_binary_fails() {
        let archive = tar_gz(&[("README", b"readme")]);
        let error = extract_binary(&archive).unwrap_err();
        assert!(error.to_string().contains("holds no meetcal"), "{error}");
        assert!(extract_binary(b"not gzip").is_err());
    }

    #[cfg(unix)]
    mod replace {
        use super::*;

        fn scratch(name: &str) -> PathBuf {
            let dir = std::env::temp_dir().join(format!(
                "meetcal-upgrade-test-{name}-{}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            dir
        }

        fn script(version: &str) -> Vec<u8> {
            format!("#!/bin/sh\necho \"meetcal {version}\"\n").into_bytes()
        }

        #[test]
        fn a_binary_reporting_the_version_replaces_the_old_one() {
            let dir = scratch("ok");
            let exe = dir.join("meetcal");
            fs::write(&exe, "old").unwrap();

            replace_binary(&exe, &script("3.1.0"), version("3.1.0")).unwrap();

            assert_eq!(fs::read(&exe).unwrap(), script("3.1.0"));
            assert_eq!(
                fs::read_dir(&dir).unwrap().count(),
                1,
                "no staged file left"
            );
            fs::remove_dir_all(&dir).unwrap();
        }

        #[test]
        fn a_binary_reporting_another_version_is_not_installed() {
            let dir = scratch("wrong");
            let exe = dir.join("meetcal");
            fs::write(&exe, "old").unwrap();

            let error = replace_binary(&exe, &script("3.0.9"), version("3.1.0")).unwrap_err();

            assert!(error.to_string().contains("not installed"), "{error}");
            assert_eq!(fs::read(&exe).unwrap(), b"old");
            assert_eq!(
                fs::read_dir(&dir).unwrap().count(),
                1,
                "no staged file left"
            );
            fs::remove_dir_all(&dir).unwrap();
        }

        #[test]
        fn a_directory_it_cannot_write_is_not_writable() {
            use std::os::unix::fs::PermissionsExt;
            let dir = scratch("readonly");
            let exe = dir.join("meetcal");
            fs::write(&exe, "old").unwrap();
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).unwrap();
            // Root writes anywhere, so the check only means something for another user.
            let writable = fs::write(dir.join("probe"), "").is_ok();

            let result = replace_binary(&exe, &script("3.1.0"), version("3.1.0"));

            fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
            if !writable {
                let error = result.unwrap_err();
                assert!(error.downcast_ref::<NotWritable>().is_some(), "{error}");
                assert_eq!(fs::read(&exe).unwrap(), b"old");
            }
            fs::remove_dir_all(&dir).unwrap();
        }
    }
}
