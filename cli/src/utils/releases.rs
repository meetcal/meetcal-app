//! The CLI's releases on GitHub: which is the newest, and where its archives are. Releases are
//! tagged `cli-vX.Y.Z` on `meetcal/meetcal-app` and are not marked the repository's latest
//! (`.github/workflows/cli-release.yml`), so the newest is picked from the release list rather
//! than GitHub's "latest" answer.

use std::cmp::Ordering;
use std::fmt;

use anyhow::{Context, Result, bail};
use serde::Deserialize;

/// The release list, newest first. 100 releases reach back far past any CLI release worth
/// upgrading to, even if the app's releases share the list.
pub const RELEASES_URL: &str =
    "https://api.github.com/repos/meetcal/meetcal-app/releases?per_page=100";

/// Points the release lookup at another list (tests).
pub const RELEASES_URL_ENV: &str = "MEETCAL_RELEASES_URL";

/// A CLI release's tag is this prefix and its version.
pub const TAG_PREFIX: &str = "cli-v";

/// The checksum file each release carries since 3.0.0: `sha256sum` lines for its archives.
pub const CHECKSUMS_ASSET: &str = "SHA256SUMS";

/// A `MAJOR.MINOR.PATCH` version. Pre-release and build suffixes are not versions the CLI
/// offers, so they do not parse.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Version {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
}

impl Version {
    pub fn parse(text: &str) -> Option<Self> {
        let mut parts = text.trim().split('.');
        let mut part = || parts.next()?.parse::<u64>().ok();
        let version = Version {
            major: part()?,
            minor: part()?,
            patch: part()?,
        };
        parts.next().is_none().then_some(version)
    }

    /// This build's version (`Cargo.toml`).
    pub fn current() -> Self {
        Self::parse(env!("CARGO_PKG_VERSION")).expect("Cargo.toml's version is MAJOR.MINOR.PATCH")
    }

    pub fn tag(&self) -> String {
        format!("{TAG_PREFIX}{self}")
    }
}

impl fmt::Display for Version {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

/// One release as GitHub lists it, with only the fields the CLI reads.
#[derive(Clone, Debug, Deserialize)]
pub struct GithubRelease {
    pub tag_name: String,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub prerelease: bool,
    #[serde(default)]
    pub assets: Vec<Asset>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct Asset {
    pub name: String,
    pub browser_download_url: String,
}

/// A published CLI release.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Release {
    pub version: Version,
    pub assets: Vec<Asset>,
}

impl Release {
    /// The download URL of the asset named `name`, if the release has one.
    pub fn asset_url(&self, name: &str) -> Option<&str> {
        self.assets
            .iter()
            .find(|asset| asset.name == name)
            .map(|asset| asset.browser_download_url.as_str())
    }
}

/// The newest published CLI release in `releases`: tagged `cli-vX.Y.Z`, neither a draft nor a
/// pre-release. Other releases of the repository are ignored.
pub fn newest(releases: Vec<GithubRelease>) -> Option<Release> {
    releases
        .into_iter()
        .filter(|release| !release.draft && !release.prerelease)
        .filter_map(|release| {
            let version = Version::parse(release.tag_name.strip_prefix(TAG_PREFIX)?)?;
            Some(Release {
                version,
                assets: release.assets,
            })
        })
        .max_by(|a, b| a.version.cmp(&b.version))
}

/// Whether `newest` is a newer version than `current`.
pub fn is_newer(newest: Version, current: Version) -> bool {
    newest.cmp(&current) == Ordering::Greater
}

/// The release list's URL: `MEETCAL_RELEASES_URL` when set, GitHub otherwise.
pub fn releases_url() -> String {
    std::env::var(RELEASES_URL_ENV)
        .ok()
        .filter(|url| !url.trim().is_empty())
        .unwrap_or_else(|| RELEASES_URL.to_string())
}

/// Asks GitHub for the newest published CLI release. `None` when there is none.
pub async fn fetch_newest(client: &reqwest::Client) -> Result<Option<Release>> {
    let url = releases_url();
    let response = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .context("Failed to reach GitHub for the CLI's releases")?;
    let status = response.status();
    if !status.is_success() {
        bail!("GitHub answered {status} for the CLI's releases");
    }
    let releases: Vec<GithubRelease> = response
        .json()
        .await
        .context("GitHub's release list was not the expected JSON")?;
    Ok(newest(releases))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(tag: &str, draft: bool, prerelease: bool) -> GithubRelease {
        GithubRelease {
            tag_name: tag.to_string(),
            draft,
            prerelease,
            assets: vec![],
        }
    }

    #[test]
    fn versions_parse_only_three_numbers() {
        assert_eq!(
            Version::parse("3.0.12"),
            Some(Version {
                major: 3,
                minor: 0,
                patch: 12
            })
        );
        for text in ["3.0", "3.0.0.1", "3.0.0-beta.1", "v3.0.0", "", "3..0"] {
            assert_eq!(Version::parse(text), None, "{text}");
        }
    }

    #[test]
    fn versions_compare_numerically() {
        let parse = |text| Version::parse(text).unwrap();
        assert!(is_newer(parse("3.0.10"), parse("3.0.9")));
        assert!(is_newer(parse("10.0.0"), parse("9.9.9")));
        assert!(!is_newer(parse("3.0.0"), parse("3.0.0")));
        assert!(!is_newer(parse("2.4.0"), parse("3.0.0")));
    }

    #[test]
    fn the_current_version_parses() {
        assert_eq!(Version::current().to_string(), env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn newest_takes_the_highest_published_cli_tag() {
        let releases = vec![
            release("v6.2.0", false, false),
            release("cli-v3.1.0-rc.1", false, false),
            release("cli-v4.0.0", true, false),
            release("cli-v3.2.0", false, true),
            release("cli-v2.10.0", false, false),
            release("cli-v3.0.1", false, false),
            release("cli-v2.4.0", false, false),
        ];
        assert_eq!(newest(releases).unwrap().version.to_string(), "3.0.1");
    }

    #[test]
    fn no_cli_release_is_none() {
        assert_eq!(newest(vec![release("v6.2.0", false, false)]), None);
        assert_eq!(newest(vec![]), None);
    }

    #[test]
    fn tags_carry_the_prefix() {
        assert_eq!(Version::parse("3.0.0").unwrap().tag(), "cli-v3.0.0");
    }
}
