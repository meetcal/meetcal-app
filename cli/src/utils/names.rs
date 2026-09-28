//! The meets, clubs and WSOs MeetCal knows, and "did you mean" suggestions when a command is given
//! a name it does not.

use anyhow::{Error, Result, anyhow};
use chrono::Utc;
use serde_json::json;

use crate::types::meets::Meet;
use crate::utils::backend::{NoArgs, queries, query};

/// Suggestions shown for a name MeetCal does not know.
pub const MAX_SUGGESTIONS: usize = 5;

/// The share of the typed words a name must match to be suggested.
const MIN_WORD_MATCH: f64 = 0.75;

const HOUR_MS: i64 = 60 * 60 * 1000;

/// What kind of name a command was given.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NameKind {
    Meet,
    Club,
    Wso,
}

impl NameKind {
    fn label(self) -> &'static str {
        match self {
            NameKind::Meet => "meet",
            NameKind::Club => "club",
            NameKind::Wso => "WSO",
        }
    }

    fn list_command(self) -> &'static str {
        match self {
            NameKind::Meet => "meetcal meets (or meetcal meets --completed)",
            NameKind::Club => "meetcal clubs --search <text>",
            NameKind::Wso => "meetcal wsos",
        }
    }
}

/// Meets starting within the next three months, and those under way, soonest first.
pub async fn upcoming_meets() -> Result<Vec<Meet>> {
    // The hour is enough, and every caller within it shares Convex's cached answer.
    let now = Utc::now().timestamp_millis() / HOUR_MS * HOUR_MS;
    query(queries::UPCOMING_MEETS, &json!({ "now": now })).await
}

/// Completed meets, newest first.
pub async fn completed_meets() -> Result<Vec<Meet>> {
    query(queries::COMPLETED_MEETS, &NoArgs {}).await
}

/// Every club name.
pub async fn clubs() -> Result<Vec<String>> {
    query(queries::CLUBS, &NoArgs {}).await
}

/// Every WSO with records.
pub async fn wsos() -> Result<Vec<String>> {
    query(queries::WSO_LIST, &NoArgs {}).await
}

/// The age groups `wso` keeps records for.
pub async fn wso_age_groups(wso: &str) -> Result<Vec<String>> {
    query(queries::WSO_AGE_GROUPS, &json!({ "wso": wso })).await
}

/// Every name of `kind` MeetCal knows.
pub async fn known_names(kind: NameKind) -> Result<Vec<String>> {
    match kind {
        NameKind::Meet => {
            let upcoming = upcoming_meets().await?;
            let completed = completed_meets().await?;
            Ok(upcoming
                .into_iter()
                .chain(completed)
                .map(|meet| meet.name)
                .collect())
        }
        NameKind::Club => clubs().await,
        NameKind::Wso => wsos().await,
    }
}

/// The error for a command that found nothing for `input`: `message`, plus the known names of
/// `kind` closest to it when `input` is not one of them. The suggestions are a hint; if they
/// cannot be fetched, the message stands alone.
pub async fn not_found(kind: NameKind, input: &str, message: String) -> Error {
    let Ok(candidates) = known_names(kind).await else {
        return anyhow!(message);
    };
    anyhow!(not_found_message(kind, input, &candidates, message))
}

/// `message`, with suggestions from `candidates` when `input` is not one of them.
pub fn not_found_message(
    kind: NameKind,
    input: &str,
    candidates: &[String],
    message: String,
) -> String {
    if candidates
        .iter()
        .any(|name| normalize(name) == normalize(input))
    {
        return message;
    }
    let close = closest(input, candidates, MAX_SUGGESTIONS);
    if close.is_empty() {
        return format!(
            "{message}\nNo {} is named like \"{input}\"; see {}.",
            kind.label(),
            kind.list_command()
        );
    }
    let list: Vec<String> = close.iter().map(|name| format!("  {name}")).collect();
    format!("{message}\nDid you mean:\n{}", list.join("\n"))
}

/// The `candidates` closest to `input`, best first. Names containing the input (or contained in
/// it) come first; then names matching most of its words, a word matching when it is the same,
/// a prefix, or a typo or two away. Case, punctuation and spacing are ignored.
pub fn closest<'a>(input: &str, candidates: &'a [String], limit: usize) -> Vec<&'a str> {
    let wanted = normalize(input);
    if wanted.is_empty() {
        return Vec::new();
    }
    let wanted_words: Vec<&str> = wanted.split(' ').collect();
    let mut scored: Vec<(u8, f64, usize, &str)> = candidates
        .iter()
        .filter_map(|candidate| {
            let name = normalize(candidate);
            if name.is_empty() {
                return None;
            }
            let length_gap = name.len().abs_diff(wanted.len());
            // A name inside the input counts only when it is most of it: "bel" is not what
            // "texas barbel clb" meant.
            if name.contains(&wanted) || (wanted.contains(&name) && name.len() * 2 >= wanted.len())
            {
                return Some((0, 0.0, length_gap, candidate.as_str()));
            }
            let words: Vec<&str> = name.split(' ').collect();
            let matched = wanted_words
                .iter()
                .filter(|wanted| words.iter().any(|word| words_match(wanted, word)))
                .count();
            let share = matched as f64 / wanted_words.len() as f64;
            (share >= MIN_WORD_MATCH).then_some((1, -share, length_gap, candidate.as_str()))
        })
        .collect();
    scored.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then(a.1.total_cmp(&b.1))
            .then(a.2.cmp(&b.2))
            .then(a.3.cmp(b.3))
    });
    let mut seen = Vec::new();
    for (_, _, _, name) in scored {
        if !seen.contains(&name) {
            seen.push(name);
        }
        if seen.len() == limit {
            break;
        }
    }
    seen
}

/// Whether a typed word matches a word of a name: the same, a prefix of at least three
/// letters, or within one edit per four letters (at least one).
fn words_match(typed: &str, word: &str) -> bool {
    if typed == word {
        return true;
    }
    if typed.len() >= 3 && word.starts_with(typed) {
        return true;
    }
    let allowed = (typed.len().max(word.len()) / 4).max(1);
    typed.len().abs_diff(word.len()) <= allowed && edit_distance(typed, word) <= allowed
}

/// Lowercase letters and digits, single-spaced.
fn normalize(value: &str) -> String {
    value
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Levenshtein distance, by characters.
fn edit_distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut current = vec![i + 1; b.len() + 1];
        for (j, cb) in b.iter().enumerate() {
            let substitution = previous[j] + usize::from(ca != cb);
            current[j + 1] = substitution.min(previous[j + 1] + 1).min(current[j] + 1);
        }
        previous = current;
    }
    previous[b.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn suggests_names_containing_the_input_first() {
        let candidates = names(&[
            "Texas-Oklahoma",
            "Carolina",
            "California North Central",
            "California South",
        ]);
        assert_eq!(
            closest("california", &candidates, 5),
            ["California South", "California North Central"]
        );
        assert_eq!(
            closest("texas oklahoma", &candidates, 5),
            ["Texas-Oklahoma"]
        );
    }

    #[test]
    fn a_typo_in_one_word_still_finds_the_meet() {
        let candidates = names(&[
            "2026 Georgia WSO Championships",
            "2026 New York State WSO Championships",
            "2026 Florida State Championships (WSO Championships)",
        ]);
        assert_eq!(
            closest("2026 Florda State Championships", &candidates, 5),
            [
                "2026 Florida State Championships (WSO Championships)",
                "2026 New York State WSO Championships"
            ]
        );
    }

    #[test]
    fn suggests_names_a_few_typos_away() {
        let candidates = names(&[
            "TEXAS BARBELL CLUB",
            "Columbus Weightlifting",
            "Oly Concepts",
            "BEL",
        ]);
        assert_eq!(
            closest("Texas Barbel Clb", &candidates, 5),
            ["TEXAS BARBELL CLUB"]
        );
        assert!(closest("Nowhere Near", &candidates, 5).is_empty());
        assert!(closest("  ", &candidates, 5).is_empty());
    }

    #[test]
    fn a_known_name_gets_no_suggestions() {
        let candidates = names(&["Florida", "Carolina"]);
        assert_eq!(
            not_found_message(NameKind::Wso, "florida", &candidates, "No results.".into()),
            "No results."
        );
        assert_eq!(
            not_found_message(NameKind::Wso, "Florda", &candidates, "No results.".into()),
            "No results.\nDid you mean:\n  Florida"
        );
        assert_eq!(
            not_found_message(NameKind::Club, "zzz", &candidates, "No results.".into()),
            "No results.\nNo club is named like \"zzz\"; see meetcal clubs --search <text>."
        );
    }

    #[test]
    fn edit_distance_counts_characters() {
        assert_eq!(edit_distance("kitten", "sitting"), 3);
        assert_eq!(edit_distance("", "abc"), 3);
        assert_eq!(edit_distance("same", "same"), 0);
    }
}
