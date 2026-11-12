use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::utils::access::PASS_ARGUMENT;
use crate::utils::credentials::same_deployment;
use crate::utils::dirs::{self, Flush};

pub(crate) const MAX_CACHE_BYTES: u64 = 64 * 1024 * 1024;

pub(crate) const MAX_ANSWER_BYTES: usize = 16 * 1024 * 1024;

pub(crate) const ACCESS_PASS_MIN_HOLD_MS: i64 = 5 * 60 * 1000;

pub(crate) const TAG_ARGUMENT: &str = "ifNoneMatch";

const PASS_FILE: &str = "pass.json";
const ANSWERS_DIR: &str = "answers";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Shelf {
    Public,
    Premium,
}

impl Shelf {
    const ALL: [Shelf; 2] = [Shelf::Public, Shelf::Premium];

    fn dir_name(self) -> &'static str {
        match self {
            Shelf::Public => "public",
            Shelf::Premium => "premium",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct TaggedAnswer {
    pub(crate) etag: String,
    pub(crate) json: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredPass {
    pub(crate) deployment: String,
    pub(crate) token_id: String,
    pub(crate) pass: String,
    pub(crate) until: i64,
}

pub(crate) fn held_until(rotates_at: i64, fetched_at_ms: i64) -> i64 {
    rotates_at.max(fetched_at_ms.saturating_add(ACCESS_PASS_MIN_HOLD_MS))
}

impl StoredPass {
    pub(crate) fn usable(&self, deployment: &str, token_id: &str, now_ms: i64) -> bool {
        same_deployment(&self.deployment, deployment)
            && self.token_id == token_id
            && now_ms < self.until
    }
}

#[derive(Clone, Debug)]
pub struct Cache {
    dir: PathBuf,
}

pub(crate) fn default_dir() -> Option<PathBuf> {
    dirs::user_dir(
        std::env::var_os("XDG_CACHE_HOME"),
        std::env::var_os("HOME"),
        std::env::var_os("LOCALAPPDATA"),
        ".cache",
    )
    .map(|dir| dir.join("meetcal"))
}

pub(crate) fn answer_key(deployment: &str, function: &str, args: &Value) -> String {
    let mut own_args = args.clone();
    if let Some(fields) = own_args.as_object_mut() {
        fields.remove(PASS_ARGUMENT);
        fields.remove(TAG_ARGUMENT);
    }
    let mut hasher = Sha256::new();
    hasher.update(deployment.trim().trim_end_matches('/').as_bytes());
    hasher.update([0]);
    hasher.update(function.as_bytes());
    hasher.update([0]);
    hasher.update(own_args.to_string().as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

impl Cache {
    pub fn at(dir: PathBuf) -> Self {
        Self { dir }
    }

    fn shelf_dir(&self, shelf: Shelf) -> PathBuf {
        self.dir.join(ANSWERS_DIR).join(shelf.dir_name())
    }

    fn answer_path(&self, shelf: Shelf, key: &str) -> PathBuf {
        self.shelf_dir(shelf).join(format!("{key}.json"))
    }

    pub(crate) fn answer(&self, shelf: Shelf, key: &str) -> Option<TaggedAnswer> {
        let path = self.answer_path(shelf, key);
        let answer = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<TaggedAnswer>(&bytes).ok());
        if answer.is_some() {
            mark_used(&path);
        }
        answer
    }

    pub(crate) fn keep(&self, shelf: Shelf, key: &str, answer: &TaggedAnswer) {
        let Ok(text) = serde_json::to_vec(answer) else {
            return;
        };
        if text.len() > MAX_ANSWER_BYTES {
            return;
        }
        let dir = self.shelf_dir(shelf);
        if dirs::create_private_dir(&dir).is_ok()
            && dirs::replace_private_file(
                &self.answer_path(shelf, key),
                &text,
                Flush::WhenTheSystemDoes,
            )
            .is_ok()
        {
            self.trim(MAX_CACHE_BYTES);
        }
    }

    pub(crate) fn trim(&self, max_bytes: u64) {
        let mut files: Vec<(SystemTime, u64, PathBuf)> = Shelf::ALL
            .iter()
            .filter_map(|shelf| fs::read_dir(self.shelf_dir(*shelf)).ok())
            .flatten()
            .filter_map(|entry| {
                let entry = entry.ok()?;
                let metadata = entry.metadata().ok()?;
                metadata.is_file().then(|| {
                    (
                        metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                        metadata.len(),
                        entry.path(),
                    )
                })
            })
            .collect();
        let mut total: u64 = files.iter().map(|(_, size, _)| size).sum();
        files.sort();
        for (_, size, path) in files {
            if total <= max_bytes {
                break;
            }
            if fs::remove_file(&path).is_ok() {
                total = total.saturating_sub(size);
            }
        }
    }

    pub(crate) fn pass(&self) -> Option<StoredPass> {
        fs::read(self.dir.join(PASS_FILE))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
    }

    pub(crate) fn keep_pass(&self, pass: &StoredPass) {
        if self.pass().is_some_and(|held| held.pass != pass.pass) {
            self.forget_premium_answers();
        }
        let Ok(text) = serde_json::to_vec(pass) else {
            return;
        };
        if dirs::create_private_dir(&self.dir).is_ok() {
            let _ = dirs::replace_private_file(&self.dir.join(PASS_FILE), &text, Flush::ToDisk);
        }
    }

    pub(crate) fn forget_premium_answers(&self) {
        let _ = fs::remove_dir_all(self.shelf_dir(Shelf::Premium));
    }

    pub fn forget_access(&self) {
        let _ = fs::remove_file(self.dir.join(PASS_FILE));
        self.forget_premium_answers();
    }
}

fn mark_used(path: &Path) {
    if let Ok(file) = fs::OpenOptions::new().write(true).open(path) {
        let _ = file.set_modified(SystemTime::now());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn scratch(name: &str) -> Cache {
        let dir = std::env::temp_dir().join(format!("meetcal-cache-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        Cache::at(dir)
    }

    fn tagged(etag: &str, json: &str) -> TaggedAnswer {
        TaggedAnswer {
            etag: etag.to_string(),
            json: json.to_string(),
        }
    }

    fn stored(pass: &str, until: i64) -> StoredPass {
        StoredPass {
            deployment: "https://a.convex.cloud".to_string(),
            token_id: "tid-1".to_string(),
            pass: pass.to_string(),
            until,
        }
    }

    #[test]
    fn an_answer_is_kept_and_read_back_on_its_shelf() {
        let cache = scratch("round-trip");
        let key = answer_key("https://a.convex.cloud", "reference:records", &json!({}));
        assert_eq!(cache.answer(Shelf::Public, &key), None);
        cache.keep(Shelf::Public, &key, &tagged("\"e1\"", "[1]"));
        cache.keep(Shelf::Public, &key, &tagged("\"e2\"", "[2]"));
        assert_eq!(
            cache.answer(Shelf::Public, &key),
            Some(tagged("\"e2\"", "[2]"))
        );
        assert_eq!(cache.answer(Shelf::Premium, &key), None);
        assert_eq!(
            fs::read_dir(cache.shelf_dir(Shelf::Public))
                .unwrap()
                .count(),
            1
        );
        fs::remove_dir_all(&cache.dir).unwrap();
    }

    #[test]
    fn a_corrupt_answer_is_ignored_then_replaced() {
        let cache = scratch("corrupt");
        let key = answer_key("https://a.convex.cloud", "reference:clubs", &json!({}));
        dirs::create_private_dir(&cache.shelf_dir(Shelf::Public)).unwrap();
        for corrupt in ["", "{\"etag\":", "[1,2]", "{\"etag\":1,\"json\":\"[]\"}"] {
            fs::write(cache.answer_path(Shelf::Public, &key), corrupt).unwrap();
            assert_eq!(cache.answer(Shelf::Public, &key), None, "{corrupt:?}");
        }
        cache.keep(Shelf::Public, &key, &tagged("\"e1\"", "[]"));
        assert_eq!(
            cache.answer(Shelf::Public, &key),
            Some(tagged("\"e1\"", "[]"))
        );
        fs::remove_dir_all(&cache.dir).unwrap();
    }

    #[test]
    fn the_key_names_the_deployment_function_and_arguments_but_not_the_pass_or_tag() {
        let key =
            |deployment: &str, function: &str, args: Value| answer_key(deployment, function, &args);
        let base = key(
            "https://a.convex.cloud",
            "meets:details",
            json!({"meet": "M"}),
        );
        assert_eq!(
            base,
            key(
                "https://a.convex.cloud/",
                "meets:details",
                json!({"meet": "M", "pass": "p1", "ifNoneMatch": "\"e\""})
            )
        );
        assert_ne!(
            base,
            key(
                "https://b.convex.cloud",
                "meets:details",
                json!({"meet": "M"})
            )
        );
        assert_ne!(
            base,
            key(
                "https://a.convex.cloud",
                "meets:schedule",
                json!({"meet": "M"})
            )
        );
        assert_ne!(
            base,
            key(
                "https://a.convex.cloud",
                "meets:details",
                json!({"meet": "N"})
            )
        );
        assert_eq!(base.len(), 64);
        assert!(base.bytes().all(|byte| byte.is_ascii_hexdigit()));
    }

    #[test]
    fn the_cache_keeps_under_its_size_by_dropping_the_least_recently_used() {
        let cache = scratch("trim");
        let answer = tagged("\"e\"", &"x".repeat(1000));
        let keys: Vec<String> = (0..4)
            .map(|n| {
                answer_key(
                    "https://a.convex.cloud",
                    "reference:records",
                    &json!({"n": n}),
                )
            })
            .collect();
        for (n, key) in keys.iter().enumerate() {
            let shelf = if n % 2 == 0 {
                Shelf::Public
            } else {
                Shelf::Premium
            };
            cache.keep(shelf, key, &answer);
            let path = cache.answer_path(shelf, key);
            let file = fs::OpenOptions::new().write(true).open(&path).unwrap();
            file.set_modified(
                SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(n as u64 + 1),
            )
            .unwrap();
        }
        assert!(cache.answer(Shelf::Public, &keys[0]).is_some());
        let one = fs::metadata(cache.answer_path(Shelf::Public, &keys[0]))
            .unwrap()
            .len();
        cache.trim(one * 2);
        assert!(cache.answer(Shelf::Public, &keys[0]).is_some());
        assert_eq!(cache.answer(Shelf::Premium, &keys[1]), None);
        assert_eq!(cache.answer(Shelf::Public, &keys[2]), None);
        assert!(cache.answer(Shelf::Premium, &keys[3]).is_some());
        fs::remove_dir_all(&cache.dir).unwrap();
    }

    #[test]
    fn an_answer_too_large_to_keep_is_not_kept() {
        let cache = scratch("too-large");
        let key = answer_key("https://a.convex.cloud", "results:byMeet", &json!({}));
        cache.keep(
            Shelf::Public,
            &key,
            &tagged("\"e\"", &"x".repeat(MAX_ANSWER_BYTES)),
        );
        assert_eq!(cache.answer(Shelf::Public, &key), None);
        let _ = fs::remove_dir_all(&cache.dir);
    }

    #[test]
    fn a_new_pass_drops_the_premium_answers_kept_with_the_old_one() {
        let cache = scratch("rotation");
        let key = answer_key("https://a.convex.cloud", "reference:records", &json!({}));
        cache.keep_pass(&stored("p1", 2_000));
        cache.keep(Shelf::Premium, &key, &tagged("\"e\"", "[]"));
        cache.keep(Shelf::Public, &key, &tagged("\"e\"", "[]"));
        cache.keep_pass(&stored("p1", 2_000));
        assert!(cache.answer(Shelf::Premium, &key).is_some());
        cache.keep_pass(&stored("p2", 3_000));
        assert_eq!(cache.pass(), Some(stored("p2", 3_000)));
        assert_eq!(cache.answer(Shelf::Premium, &key), None);
        assert!(cache.answer(Shelf::Public, &key).is_some());
        fs::remove_dir_all(&cache.dir).unwrap();
    }

    #[test]
    fn forgetting_access_drops_the_pass_and_premium_answers_only() {
        let cache = scratch("forget");
        let key = answer_key("https://a.convex.cloud", "reference:records", &json!({}));
        cache.keep_pass(&stored("p1", 2_000));
        cache.keep(Shelf::Premium, &key, &tagged("\"e\"", "[]"));
        cache.keep(Shelf::Public, &key, &tagged("\"e\"", "[]"));
        cache.forget_access();
        assert_eq!(cache.pass(), None);
        assert_eq!(cache.answer(Shelf::Premium, &key), None);
        assert!(cache.answer(Shelf::Public, &key).is_some());
        fs::remove_dir_all(&cache.dir).unwrap();
    }

    #[test]
    fn a_stored_pass_is_used_on_its_login_until_it_is_due() {
        let pass = stored("p1", 10_000);
        assert!(pass.usable("https://a.convex.cloud/", "tid-1", 9_999));
        assert!(!pass.usable("https://a.convex.cloud", "tid-1", 10_000));
        assert!(!pass.usable("https://b.convex.cloud", "tid-1", 1_000));
        assert!(!pass.usable("https://a.convex.cloud", "tid-2", 1_000));
        let days_ahead = stored("p1", 10 * 24 * 60 * 60 * 1000);
        assert!(days_ahead.usable("https://a.convex.cloud", "tid-1", 1_000));
    }

    #[test]
    fn a_pass_is_held_at_least_the_app_s_minimum_however_early_it_rotates() {
        let fetched_at = 1_000_000;
        assert_eq!(
            held_until(fetched_at - 60_000, fetched_at),
            fetched_at + ACCESS_PASS_MIN_HOLD_MS
        );
        assert_eq!(
            held_until(fetched_at + 1, fetched_at),
            fetched_at + ACCESS_PASS_MIN_HOLD_MS
        );
        let tomorrow = fetched_at + 24 * 60 * 60 * 1000;
        assert_eq!(held_until(tomorrow, fetched_at), tomorrow);
        assert_eq!(ACCESS_PASS_MIN_HOLD_MS, 5 * 60 * 1000);
    }

    #[test]
    fn an_unreadable_pass_file_is_no_pass() {
        let cache = scratch("bad-pass");
        dirs::create_private_dir(&cache.dir).unwrap();
        fs::write(cache.dir.join(PASS_FILE), "{\"pass\":").unwrap();
        assert_eq!(cache.pass(), None);
        fs::remove_dir_all(&cache.dir).unwrap();
    }
}
