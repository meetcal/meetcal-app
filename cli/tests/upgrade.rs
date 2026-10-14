//! `meetcal upgrade`, run as a binary against a local HTTP server that plays GitHub's release
//! list and downloads (`MEETCAL_RELEASES_URL`). Nothing here calls GitHub.

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::thread;

use meetcal::utils::upgrade::{archive_name, artifact, sha256_hex};
use serde_json::json;

const CURRENT: &str = env!("CARGO_PKG_VERSION");

/// Serves the files `files` builds from the server's base URL, by path (`/releases`,
/// `/linux-x64.tar.gz`, …), 404 for anything else, until the test ends. Returns the base URL.
fn serve_with(files: impl FnOnce(&str) -> HashMap<String, (u16, Vec<u8>)>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind local test server");
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    let files = files(&base_url);
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };
            let mut reader = BufReader::new(&stream);
            let mut request_line = String::new();
            let _ = reader.read_line(&mut request_line);
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                    break;
                }
            }
            let path = request_line.split(' ').nth(1).unwrap_or_default();
            let (status, body) = files
                .get(path)
                .cloned()
                .unwrap_or((404, b"not found".to_vec()));
            let head = format!(
                "HTTP/1.1 {status} X\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(&body);
        }
    });
    base_url
}

/// The GitHub release list naming `version`, with this machine's archive and the checksums.
fn release_list(base_url: &str, version: &str, archive: &str) -> Vec<u8> {
    json!([
        { "tag_name": "v6.2.0", "draft": false, "prerelease": false, "assets": [] },
        {
            "tag_name": format!("cli-v{version}"),
            "draft": false,
            "prerelease": false,
            "assets": [
                { "name": archive, "browser_download_url": format!("{base_url}/{archive}") },
                { "name": "SHA256SUMS", "browser_download_url": format!("{base_url}/SHA256SUMS") }
            ]
        }
    ])
    .to_string()
    .into_bytes()
}

fn tar_gz(name: &str, bytes: &[u8]) -> Vec<u8> {
    let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
        Vec::new(),
        flate2::Compression::default(),
    ));
    let mut header = tar::Header::new_gnu();
    header.set_size(bytes.len() as u64);
    header.set_mode(0o755);
    header.set_cksum();
    builder.append_data(&mut header, name, bytes).unwrap();
    builder.into_inner().unwrap().finish().unwrap()
}

/// A copy of the built binary in its own directory, so `upgrade` replaces the copy.
fn installed_copy(test: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("meetcal-upgrade-{test}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let exe = dir.join("meetcal");
    fs::copy(env!("CARGO_BIN_EXE_meetcal"), &exe).unwrap();
    exe
}

fn run(exe: &Path, base_url: &str, args: &[&str]) -> Output {
    Command::new(exe)
        .args(args)
        .env("MEETCAL_RELEASES_URL", format!("{base_url}/releases"))
        .env("MEETCAL_NO_UPDATE_CHECK", "1")
        .output()
        .expect("run meetcal")
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

/// This machine's archive name, or `None` where no release binary is built.
fn this_archive() -> Option<String> {
    artifact(std::env::consts::OS, std::env::consts::ARCH).map(archive_name)
}

#[test]
fn check_exits_1_when_a_newer_release_is_out() {
    let base_url = serve_with(|base_url| {
        HashMap::from([(
            "/releases".to_string(),
            (200, release_list(base_url, "99.0.0", "linux-x64.tar.gz")),
        )])
    });

    let output = run(
        Path::new(env!("CARGO_BIN_EXE_meetcal")),
        &base_url,
        &["upgrade", "--check"],
    );

    assert_eq!(output.status.code(), Some(1), "{}", stderr(&output));
    assert!(
        stderr(&output).contains(&format!("meetcal 99.0.0 is out (you have {CURRENT})")),
        "{}",
        stderr(&output)
    );
}

#[test]
fn check_exits_0_when_this_is_the_newest() {
    let base_url = serve_with(|base_url| {
        HashMap::from([(
            "/releases".to_string(),
            (200, release_list(base_url, CURRENT, "linux-x64.tar.gz")),
        )])
    });

    let output = run(
        Path::new(env!("CARGO_BIN_EXE_meetcal")),
        &base_url,
        &["upgrade", "--check"],
    );

    assert_eq!(output.status.code(), Some(0), "{}", stderr(&output));
    assert!(
        stderr(&output).contains("is the newest release"),
        "{}",
        stderr(&output)
    );
}

#[test]
fn a_github_failure_is_an_error() {
    let base_url =
        serve_with(|_| HashMap::from([("/releases".to_string(), (500, b"oops".to_vec()))]));

    let output = run(
        Path::new(env!("CARGO_BIN_EXE_meetcal")),
        &base_url,
        &["upgrade"],
    );

    assert!(!output.status.success());
    assert!(
        stderr(&output).contains("GitHub answered 500"),
        "{}",
        stderr(&output)
    );
}

#[cfg(unix)]
#[test]
fn a_downloaded_binary_replaces_itself_with_the_checked_release() {
    let Some(archive) = this_archive() else {
        return;
    };
    let new_binary = b"#!/bin/sh\necho \"meetcal 99.0.0\"\n".to_vec();
    let archive_bytes = tar_gz("meetcal", &new_binary);
    let sums = format!("{}  {archive}\n", sha256_hex(&archive_bytes));
    let base_url = serve_with(|base_url| {
        HashMap::from([
            (
                "/releases".to_string(),
                (200, release_list(base_url, "99.0.0", &archive)),
            ),
            (format!("/{archive}"), (200, archive_bytes.clone())),
            ("/SHA256SUMS".to_string(), (200, sums.clone().into_bytes())),
        ])
    });
    let exe = installed_copy("ok");

    let output = run(&exe, &base_url, &["upgrade"]);

    assert!(output.status.success(), "{}", stderr(&output));
    assert!(
        stderr(&output).contains("Upgraded to meetcal 99.0.0"),
        "{}",
        stderr(&output)
    );
    assert_eq!(fs::read(&exe).unwrap(), new_binary);
    let leftovers = fs::read_dir(exe.parent().unwrap()).unwrap().count();
    assert_eq!(leftovers, 1, "only the binary is left");
    fs::remove_dir_all(exe.parent().unwrap()).unwrap();
}

#[cfg(unix)]
#[test]
fn an_archive_that_fails_its_checksum_is_not_installed() {
    let Some(archive) = this_archive() else {
        return;
    };
    let archive_bytes = tar_gz("meetcal", b"#!/bin/sh\necho \"meetcal 99.0.0\"\n");
    let sums = format!("{}  {archive}\n", "0".repeat(64));
    let base_url = serve_with(|base_url| {
        HashMap::from([
            (
                "/releases".to_string(),
                (200, release_list(base_url, "99.0.0", &archive)),
            ),
            (format!("/{archive}"), (200, archive_bytes.clone())),
            ("/SHA256SUMS".to_string(), (200, sums.clone().into_bytes())),
        ])
    });
    let exe = installed_copy("bad-sum");
    let before = fs::read(&exe).unwrap();

    let output = run(&exe, &base_url, &["upgrade"]);

    assert!(!output.status.success());
    assert!(
        stderr(&output).contains("does not match its checksum"),
        "{}",
        stderr(&output)
    );
    assert_eq!(
        fs::read(&exe).unwrap(),
        before,
        "the installed binary is untouched"
    );
    fs::remove_dir_all(exe.parent().unwrap()).unwrap();
}

#[cfg(unix)]
#[test]
fn a_release_without_checksums_is_not_installed() {
    let Some(archive) = this_archive() else {
        return;
    };
    let base_url = serve_with(|base_url| {
        let list = json!([{
            "tag_name": "cli-v99.0.0",
            "assets": [{ "name": archive, "browser_download_url": format!("{base_url}/{archive}") }]
        }]);
        HashMap::from([(
            "/releases".to_string(),
            (200, list.to_string().into_bytes()),
        )])
    });
    let exe = installed_copy("no-sums");
    let before = fs::read(&exe).unwrap();

    let output = run(&exe, &base_url, &["upgrade"]);

    assert!(!output.status.success());
    assert!(
        stderr(&output).contains("no SHA256SUMS"),
        "{}",
        stderr(&output)
    );
    assert_eq!(fs::read(&exe).unwrap(), before);
    fs::remove_dir_all(exe.parent().unwrap()).unwrap();
}
