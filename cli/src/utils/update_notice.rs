//! The one-line notice that a newer CLI is out. At most once a day a command asks GitHub for the
//! newest release, alongside its own work, and at most once a day it says so on stderr when that
//! is newer than this build. Both times are kept in `update-check.json` beside the saved login
//! (`credentials::meetcal_dir`). Never shown when stderr is not a terminal (pipes, scripts,
//! agents), under CI, or with `MEETCAL_NO_UPDATE_CHECK` set; a failure is silent.

use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::task::JoinHandle;

use crate::utils::backend;
use crate::utils::credentials;
use crate::utils::releases::{self, Version};

/// Set (to anything but `0` or `false`) to turn the notice and its check off.
pub const OPT_OUT_ENV: &str = "MEETCAL_NO_UPDATE_CHECK";

/// The cache's file name inside the CLI's config directory.
pub const CACHE_FILE: &str = "update-check.json";

/// How often GitHub is asked, and how often the notice shows.
pub const INTERVAL_MS: i64 = 24 * 60 * 60 * 1000;

/// Longest the check may take on its own.
pub const CHECK_TIMEOUT: Duration = Duration::from_secs(5);

/// Longest a finished command waits for a check still running. Past this the check is dropped
/// and the next command asks again.
pub const FINISH_GRACE: Duration = Duration::from_millis(300);

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cache {
    /// When GitHub was last asked (epoch milliseconds), answered or not.
    #[serde(default)]
    pub checked_at: i64,
    /// The newest release GitHub named then.
    #[serde(default)]
    pub latest: Option<String>,
    /// When the notice was last shown.
    #[serde(default)]
    pub notified_at: i64,
}

impl Cache {
    /// Whether GitHub is due to be asked at `now_ms`.
    pub fn needs_check(&self, now_ms: i64) -> bool {
        now_ms - self.checked_at >= INTERVAL_MS || now_ms < self.checked_at
    }

    /// The notice to show at `now_ms` for this build's `current` version, if one is due.
    pub fn notice(&self, current: Version, now_ms: i64) -> Option<String> {
        let latest = Version::parse(self.latest.as_deref()?)?;
        let due = now_ms - self.notified_at >= INTERVAL_MS || now_ms < self.notified_at;
        (due && releases::is_newer(latest, current))
            .then(|| format!("meetcal {latest} is out (you have {current}): run `meetcal upgrade`"))
    }
}

/// Whether the notice is on: stderr is a terminal, not under CI, and not turned off.
pub fn enabled(stderr_is_terminal: bool, ci: Option<&OsStr>, opt_out: Option<&OsStr>) -> bool {
    let set = |value: Option<&OsStr>| {
        value.is_some_and(|value| !value.is_empty() && value != "0" && value != "false")
    };
    stderr_is_terminal && !set(ci) && !set(opt_out)
}

/// The cache at `path`; an empty one when it is missing or unreadable.
pub fn load(path: &Path) -> Cache {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Saves the cache at `path`, through a temporary file so a reader never sees half of it. The
/// directory is created private, as the saved login's is.
/// Failures are ignored: the notice is a nicety.
pub fn save(path: &Path, cache: &Cache) {
    let Some(dir) = path.parent() else { return };
    let Ok(text) = serde_json::to_string(cache) else {
        return;
    };
    let temporary = dir.join(format!(".{CACHE_FILE}.{}.tmp", std::process::id()));
    let saved = credentials::create_private_dir(dir)
        .and_then(|()| fs::write(&temporary, text))
        .and_then(|()| fs::rename(&temporary, path));
    if saved.is_err() {
        let _ = fs::remove_file(&temporary);
    }
}

/// A command's notice: the cache read when it started and the check running beside it.
pub struct Pending {
    path: PathBuf,
    cache: Cache,
    check: Option<JoinHandle<Option<String>>>,
}

/// Starts the notice for this run, or `None` when it is off or the config directory is unknown.
pub fn start() -> Option<Pending> {
    use std::io::IsTerminal;
    let on = enabled(
        std::io::stderr().is_terminal(),
        std::env::var_os("CI").as_deref(),
        std::env::var_os(OPT_OUT_ENV).as_deref(),
    );
    if !on {
        return None;
    }
    let path = credentials::meetcal_dir()?.join(CACHE_FILE);
    let cache = load(&path);
    let check = cache.needs_check(now_ms()).then(|| {
        tokio::spawn(async {
            let client = backend::client().ok()?;
            let newest = tokio::time::timeout(CHECK_TIMEOUT, releases::fetch_newest(client))
                .await
                .ok()?
                .ok()?;
            Some(
                newest
                    .map(|release| release.version.to_string())
                    .unwrap_or_default(),
            )
        })
    });
    Some(Pending { path, cache, check })
}

impl Pending {
    /// Records a finished check (waiting at most [`FINISH_GRACE`] for one still running) and
    /// prints the notice to stderr if one is due.
    pub async fn finish(self) {
        let Pending {
            path,
            mut cache,
            check,
        } = self;
        let now = now_ms();
        let mut changed = false;
        // A check still running after the grace is dropped, unrecorded, so the next command asks.
        if let Some(check) = check
            && let Ok(Ok(answer)) = tokio::time::timeout(FINISH_GRACE, check).await
        {
            cache.checked_at = now;
            // An answer naming no release, or a failed ask, keeps what was known.
            if let Some(latest) = answer.filter(|latest| !latest.is_empty()) {
                cache.latest = Some(latest);
            }
            changed = true;
        }
        if let Some(notice) = cache.notice(Version::current(), now) {
            eprintln!("{notice}");
            cache.notified_at = now;
            changed = true;
        }
        if changed {
            save(&path, &cache);
        }
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: i64 = INTERVAL_MS;

    fn version(text: &str) -> Version {
        Version::parse(text).unwrap()
    }

    #[test]
    fn github_is_asked_once_a_day() {
        let cache = Cache {
            checked_at: 10 * DAY,
            ..Cache::default()
        };
        assert!(!cache.needs_check(10 * DAY + DAY - 1));
        assert!(cache.needs_check(11 * DAY));
        assert!(Cache::default().needs_check(DAY));
        // A clock that went backwards asks again rather than waiting it out.
        assert!(cache.needs_check(9 * DAY));
    }

    #[test]
    fn the_notice_shows_for_a_newer_release_once_a_day() {
        let cache = Cache {
            checked_at: 10 * DAY,
            latest: Some("3.1.0".into()),
            notified_at: 10 * DAY,
        };
        assert_eq!(cache.notice(version("3.0.0"), 10 * DAY + 1), None);
        assert_eq!(
            cache.notice(version("3.0.0"), 11 * DAY).as_deref(),
            Some("meetcal 3.1.0 is out (you have 3.0.0): run `meetcal upgrade`")
        );
    }

    #[test]
    fn no_notice_when_up_to_date_or_unknown() {
        let cache = |latest: Option<&str>| Cache {
            latest: latest.map(str::to_string),
            ..Cache::default()
        };
        assert_eq!(cache(Some("3.0.0")).notice(version("3.0.0"), DAY), None);
        assert_eq!(cache(Some("2.4.0")).notice(version("3.0.0"), DAY), None);
        assert_eq!(cache(Some("garbage")).notice(version("3.0.0"), DAY), None);
        assert_eq!(cache(None).notice(version("3.0.0"), DAY), None);
    }

    #[test]
    fn the_notice_is_off_without_a_terminal_under_ci_or_when_turned_off() {
        let s = |text: &'static str| Some(OsStr::new(text));
        assert!(enabled(true, None, None));
        assert!(!enabled(false, None, None));
        assert!(!enabled(true, s("true"), None));
        assert!(!enabled(true, None, s("1")));
        assert!(enabled(true, s(""), s("0")));
        assert!(enabled(true, s("false"), s("false")));
    }

    #[test]
    fn the_cache_round_trips_and_a_bad_one_reads_empty() {
        let dir = std::env::temp_dir().join(format!("meetcal-notice-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let path = dir.join("nested").join(CACHE_FILE);
        assert_eq!(load(&path), Cache::default());

        let cache = Cache {
            checked_at: 1,
            latest: Some("3.1.0".into()),
            notified_at: 2,
        };
        save(&path, &cache);
        assert_eq!(load(&path), cache);
        #[cfg(unix)]
        {
            // The directory also holds the saved login, so it is created private.
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(path.parent().unwrap())
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o700);
        }

        fs::write(&path, "not json").unwrap();
        assert_eq!(load(&path), Cache::default());
        fs::remove_dir_all(&dir).unwrap();
    }
}
