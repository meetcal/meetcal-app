//! The MeetCal login `meetcal login` saves: a MeetCal-issued token (`convex/apiTokens.ts`) and the
//! deployment that issued it, in `credentials.json` under the user's config directory. Only the
//! access pass fetch (`utils::access`) and `meetcal logout` send the token; data reads never do.

use std::ffi::OsString;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

/// The file's name inside `<config dir>/meetcal/`.
pub const CREDENTIALS_FILE: &str = "credentials.json";

/// A saved login.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    /// The MeetCal-issued JWT, sent as `Authorization: Bearer` to `accessPass:pass` and
    /// `apiTokens:revoke` only.
    pub token: String,
    pub token_id: String,
    /// When the token stops working (epoch milliseconds).
    #[serde(deserialize_with = "crate::utils::backend::whole_number")]
    pub expires_at: i64,
    /// The Convex deployment that issued the token (`backend::convex_url()` at login). Another
    /// deployment would not accept it, so it is used only there.
    pub deployment: String,
}

impl Credentials {
    /// Whether the token has expired at `now_ms`.
    pub fn is_expired(&self, now_ms: i64) -> bool {
        now_ms >= self.expires_at
    }

    /// Whether the token was issued by the deployment at `base_url`.
    pub fn is_for(&self, base_url: &str) -> bool {
        same_deployment(&self.deployment, base_url)
    }
}

/// Whether two deployment URLs name the same deployment (a trailing `/` aside).
pub fn same_deployment(a: &str, b: &str) -> bool {
    a.trim().trim_end_matches('/') == b.trim().trim_end_matches('/')
}

/// Where the login is saved: `$XDG_CONFIG_HOME/meetcal/credentials.json` when `XDG_CONFIG_HOME`
/// is set, else `~/.config/meetcal/credentials.json` (on macOS too, like most CLIs), or
/// `%APPDATA%\meetcal\credentials.json` on Windows. `None` when no home directory is known.
pub fn default_path() -> Option<PathBuf> {
    config_dir(
        std::env::var_os("XDG_CONFIG_HOME"),
        std::env::var_os("HOME"),
        std::env::var_os("APPDATA"),
    )
    .map(|dir| dir.join("meetcal").join(CREDENTIALS_FILE))
}

/// The config directory from the environment's values. Relative or empty values are ignored, as
/// the XDG spec asks.
fn config_dir(
    xdg_config_home: Option<OsString>,
    home: Option<OsString>,
    appdata: Option<OsString>,
) -> Option<PathBuf> {
    let absolute =
        |value: Option<OsString>| value.map(PathBuf::from).filter(|path| path.is_absolute());
    if let Some(dir) = absolute(xdg_config_home) {
        return Some(dir);
    }
    if cfg!(windows)
        && let Some(dir) = absolute(appdata)
    {
        return Some(dir);
    }
    absolute(home).map(|home| home.join(".config"))
}

/// The login saved at `path`, or `None` when there is none.
pub fn load(path: &Path) -> Result<Option<Credentials>> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(error).with_context(|| {
                format!("Failed to read your MeetCal login ({})", path.display())
            });
        }
    };
    serde_json::from_str(&text)
        .map(Some)
        .with_context(|| format!("Your MeetCal login ({}) is unreadable", path.display()))
}

/// Saves `credentials` at `path`, readable by the user alone (0600 on Unix, in a 0700 directory
/// when it creates one). Writes a temporary file and renames it over the old one, so a failed
/// write never leaves half a file.
pub fn save(path: &Path, credentials: &Credentials) -> Result<()> {
    let dir = path
        .parent()
        .with_context(|| format!("{} has no parent directory", path.display()))?;
    create_private_dir(dir).with_context(|| format!("Failed to create {}", dir.display()))?;

    let mut text = serde_json::to_string_pretty(credentials)?;
    text.push('\n');
    let temporary = dir.join(format!(".{CREDENTIALS_FILE}.{}.tmp", std::process::id()));
    let _ = fs::remove_file(&temporary);
    let written =
        write_private_file(&temporary, text.as_bytes()).and_then(|()| fs::rename(&temporary, path));
    if written.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    written.with_context(|| format!("Failed to save your MeetCal login to {}", path.display()))
}

/// Deletes the login at `path`; `false` when there was none.
pub fn delete(path: &Path) -> Result<bool> {
    match fs::remove_file(path) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error)
            .with_context(|| format!("Failed to delete your MeetCal login ({})", path.display())),
    }
}

#[cfg(unix)]
fn create_private_dir(dir: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)
}

#[cfg(not(unix))]
fn create_private_dir(dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dir)
}

fn write_private_file(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(contents)?;
    file.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("meetcal-credentials-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn credentials(token: &str) -> Credentials {
        Credentials {
            token: token.to_string(),
            token_id: "tid-1".to_string(),
            expires_at: 1_800_000_000_000,
            deployment: "https://example.convex.cloud".to_string(),
        }
    }

    #[test]
    fn the_config_dir_follows_xdg_then_home() {
        let os = |value: &str| Some(OsString::from(value));
        assert_eq!(
            config_dir(os("/xdg"), os("/home/u"), None),
            Some(PathBuf::from("/xdg"))
        );
        // A relative or empty XDG_CONFIG_HOME is ignored.
        for xdg in [os("relative/dir"), os(""), None] {
            assert_eq!(
                config_dir(xdg, os("/home/u"), None),
                Some(PathBuf::from("/home/u/.config"))
            );
        }
        if !cfg!(windows) {
            assert_eq!(config_dir(None, None, os("/appdata")), None);
        }
    }

    #[test]
    fn the_default_path_ends_in_meetcal_credentials() {
        if let Some(path) = default_path() {
            assert!(path.ends_with("meetcal/credentials.json"), "{path:?}");
        }
    }

    #[test]
    fn credentials_round_trip_and_replace() {
        let dir = scratch_dir("round-trip");
        let path = dir.join("nested").join(CREDENTIALS_FILE);
        assert_eq!(load(&path).unwrap(), None);

        save(&path, &credentials("first")).unwrap();
        assert_eq!(load(&path).unwrap(), Some(credentials("first")));
        save(&path, &credentials("second")).unwrap();
        assert_eq!(load(&path).unwrap(), Some(credentials("second")));

        let text = fs::read_to_string(&path).unwrap();
        let fields: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(
            fields,
            serde_json::json!({
                "token": "second",
                "tokenId": "tid-1",
                "expiresAt": 1_800_000_000_000_i64,
                "deployment": "https://example.convex.cloud",
            })
        );
        // No temporary file is left behind.
        assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);

        assert!(delete(&path).unwrap());
        assert!(!delete(&path).unwrap());
        assert_eq!(load(&path).unwrap(), None);
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn credentials_are_readable_by_the_user_alone() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch_dir("permissions");
        let path = dir.join("meetcal").join(CREDENTIALS_FILE);
        save(&path, &credentials("secret")).unwrap();
        let mode = |path: &Path| fs::metadata(path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&path), 0o600);
        assert_eq!(mode(path.parent().unwrap()), 0o700);

        // A file someone widened is replaced by a private one.
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        save(&path, &credentials("secret")).unwrap();
        assert_eq!(mode(&path), 0o600);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_unreadable_file_is_an_error() {
        let dir = scratch_dir("unreadable");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(CREDENTIALS_FILE);
        fs::write(&path, "{\"token\": 1}").unwrap();
        let error = load(&path).unwrap_err();
        assert!(error.to_string().contains("is unreadable"), "{error}");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn expiry_and_deployment() {
        let saved = credentials("t");
        assert!(!saved.is_expired(saved.expires_at - 1));
        assert!(saved.is_expired(saved.expires_at));
        assert!(saved.is_for("https://example.convex.cloud/"));
        assert!(!saved.is_for("https://other.convex.cloud"));
    }
}
