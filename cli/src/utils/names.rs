//! The meets, clubs and WSOs MeetCal knows, and "did you mean" suggestions when a command is given
//! a name it does not.

use anyhow::{Error, Result, anyhow};
use chrono::Utc;
use serde::Deserialize;
use serde_json::json;
use tokio::task::JoinSet;

use crate::types::meets::Meet;
use crate::utils::backend::{NoArgs, queries, query};

/// Suggestions shown for a name MeetCal does not know.
pub const MAX_SUGGESTIONS: usize = 5;

/// The share of the typed words a name must match to be suggested.
const MIN_WORD_MATCH: f64 = 0.75;

const HOUR_MS: i64 = 60 * 60 * 1000;

/// Pages of meet names read for suggestions per name range (500 names a page).
const SUGGESTION_PAGES: usize = 6;

/// Most pages of meet names one range is read for; a server that never finishes stops here.
pub const MAX_NAME_PAGES: usize = 100;

/// What kind of name a command was given.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NameKind {
    /// A meet MeetCal tracks: its start list, schedule or details.
    Meet,
    /// A meet's results: any meet in the results, tracked or not.
    ResultsMeet,
    Club,
    /// A WSO as registrations name it (the club and WSO reports).
    Wso,
    /// A WSO with record sheets (`wso-records`).
    RecordWso,
}

impl NameKind {
    fn label(self) -> &'static str {
        match self {
            NameKind::Meet | NameKind::ResultsMeet => "meet",
            NameKind::Club => "club",
            NameKind::Wso | NameKind::RecordWso => "WSO",
        }
    }

    fn list_command(self) -> &'static str {
        match self {
            NameKind::Meet => "meetcal meets (or meetcal meets --completed)",
            NameKind::ResultsMeet => {
                "meetcal meets --completed, or meetcal attendance <words> for older meets"
            }
            NameKind::Club => "meetcal clubs --search <text>",
            NameKind::Wso | NameKind::RecordWso => "meetcal wsos",
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

/// Every WSO name on registrations, the names the club and WSO reports match.
pub async fn registration_wsos() -> Result<Vec<String>> {
    query(queries::REGISTRATION_WSOS, &NoArgs {}).await
}

#[derive(Deserialize)]
struct NamesPage {
    json: String,
    next: Option<String>,
}

#[derive(Deserialize)]
struct MeetName {
    meet: String,
}

/// The distinct meet names in `source` (`results` or `registrations`) after `after` and before
/// `before` (both excluded; `None` for no bound), in name order, at most `max_pages` pages of
/// `meets:namesPage`. More than that is an error unless `partial`, which keeps what was read.
pub async fn meet_names_between(
    source: &'static str,
    after: Option<String>,
    before: Option<String>,
    max_pages: usize,
    partial: bool,
) -> Result<Vec<String>> {
    let mut names = Vec::new();
    let mut after = after;
    for _ in 0..max_pages {
        let mut args = json!({ "source": source, "after": after });
        if let Some(before) = &before {
            args["before"] = json!(before);
        }
        let page: NamesPage = query(queries::MEET_NAMES_PAGE, &args).await?;
        let meets: Vec<MeetName> = serde_json::from_str(&page.json).map_err(|error| {
            anyhow!("Unexpected answer from MeetCal query meets:namesPage: {error}")
        })?;
        names.extend(meets.into_iter().map(|m| m.meet));
        match page.next {
            Some(next) => after = Some(next),
            None => return Ok(names),
        }
    }
    if partial {
        return Ok(names);
    }
    Err(anyhow!(
        "MeetCal query meets:namesPage did not finish within {max_pages} pages"
    ))
}

/// The greatest string sorting before `boundary` for our purposes: `boundary` with its last
/// character stepped back and a high character appended, so a range `after` it includes
/// `boundary`.
pub fn just_before(boundary: &str) -> String {
    let mut chars: Vec<char> = boundary.chars().collect();
    let Some(last) = chars.pop() else {
        return String::new();
    };
    let previous = char::from_u32(last as u32 - 1).unwrap_or(last);
    chars.push(previous);
    let mut out: String = chars.into_iter().collect();
    out.push('\u{10FFFF}');
    out
}

/// The name prefixes a results meet like `input` probably starts with: its first word as typed
/// and capitalized, and those after "The ". Meet names sort by their bytes, so each prefix is a
/// short range of `meets:namesPage` to list instead of every name.
pub fn meet_prefixes(input: &str) -> Vec<String> {
    let mut words = input.split_whitespace();
    let mut first = words.next().unwrap_or_default();
    if first.eq_ignore_ascii_case("the") {
        first = words.next().unwrap_or_default();
    }
    if first.is_empty() {
        return Vec::new();
    }
    let mut capitalized = first.to_lowercase();
    if let Some(initial) = capitalized.get(..1) {
        capitalized = initial.to_uppercase() + &capitalized[1..];
    }
    let mut prefixes = Vec::new();
    for word in [first.to_string(), capitalized, first.to_uppercase()] {
        for prefix in [format!("{word} "), format!("The {word} ")] {
            if !prefixes.contains(&prefix) {
                prefixes.push(prefix);
            }
        }
    }
    prefixes
}

/// Results meet names starting with any of `prefixes`, read side by side.
async fn results_meets_with_prefixes(prefixes: Vec<String>) -> Vec<String> {
    let mut tasks = JoinSet::new();
    for prefix in prefixes {
        tasks.spawn(meet_names_between(
            "results",
            Some(just_before(&prefix)),
            Some(format!("{prefix}\u{10FFFF}")),
            SUGGESTION_PAGES,
            true,
        ));
    }
    let mut names = Vec::new();
    while let Some(result) = tasks.join_next().await {
        if let Ok(Ok(found)) = result {
            names.extend(found);
        }
    }
    names
}

/// The age groups `wso` keeps records for.
pub async fn wso_age_groups(wso: &str) -> Result<Vec<String>> {
    query(queries::WSO_AGE_GROUPS, &json!({ "wso": wso })).await
}

/// The names of `kind` to suggest for `input`: every one MeetCal knows, except results meets,
/// which are too many to list (7,000 and more): those are the tracked meets plus the results
/// meets whose names start like `input`.
pub async fn known_names(kind: NameKind, input: &str) -> Result<Vec<String>> {
    match kind {
        NameKind::Meet | NameKind::ResultsMeet => {
            let upcoming = upcoming_meets().await?;
            let completed = completed_meets().await?;
            let mut names: Vec<String> = upcoming
                .into_iter()
                .chain(completed)
                .map(|meet| meet.name)
                .collect();
            if kind == NameKind::ResultsMeet {
                names.extend(results_meets_with_prefixes(meet_prefixes(input)).await);
            }
            names.sort();
            names.dedup();
            Ok(names)
        }
        NameKind::Club => clubs().await,
        // A deployment without the registrations list still has the record sheets' names, which
        // are mostly the same.
        NameKind::Wso => match registration_wsos().await {
            Ok(names) => Ok(names),
            Err(_) => wsos().await,
        },
        NameKind::RecordWso => wsos().await,
    }
}

/// The error for a command that found nothing for `input`: `message`, plus the known names of
/// `kind` closest to it when `input` is not one of them. The suggestions are a hint; if they
/// cannot be fetched, the message stands alone.
pub async fn not_found(kind: NameKind, input: &str, message: String) -> Error {
    let Ok(candidates) = known_names(kind, input).await else {
        return anyhow!(message);
    };
    anyhow!(not_found_message(kind, input, &candidates, message))
}

/// `message`, with suggestions from `candidates` unless `input` is exactly one of them (a known
/// name with nothing to show). A name that differs from the input only in case, punctuation or
/// spacing is suggested alone: the queries match names exactly, so it is the one to use.
pub fn not_found_message(
    kind: NameKind,
    input: &str,
    candidates: &[String],
    message: String,
) -> String {
    if candidates.iter().any(|name| name == input) {
        return message;
    }
    let same: Vec<&String> = candidates
        .iter()
        .filter(|name| normalize(name) == normalize(input))
        .collect();
    if !same.is_empty() {
        let list: Vec<String> = same.iter().map(|name| format!("  {name}")).collect();
        return format!("{message}\nDid you mean:\n{}", list.join("\n"));
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
            not_found_message(NameKind::Wso, "Florida", &candidates, "No results.".into()),
            "No results."
        );
        // The queries match exactly, so a name differing in case only is the one to use.
        assert_eq!(
            not_found_message(NameKind::Wso, "florida", &candidates, "No results.".into()),
            "No results.\nDid you mean:\n  Florida"
        );
        let meets = names(&[
            "2026 Carolina WSO Championship",
            "2025 Carolina WSO Championship",
        ]);
        assert_eq!(
            not_found_message(
                NameKind::Meet,
                "2026 CAROLINA WSO CHAMPIONSHIP",
                &meets,
                "No meet.".into()
            ),
            "No meet.\nDid you mean:\n  2026 Carolina WSO Championship"
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
    fn results_meets_are_listed_from_the_input_s_first_word() {
        assert_eq!(
            meet_prefixes("2023 Ohio WSO Championship"),
            ["2023 ", "The 2023 "]
        );
        assert_eq!(meet_prefixes("the 2023 ohio"), ["2023 ", "The 2023 "]);
        assert_eq!(
            meet_prefixes("ohio open"),
            [
                "ohio ",
                "The ohio ",
                "Ohio ",
                "The Ohio ",
                "OHIO ",
                "The OHIO "
            ]
        );
        assert!(meet_prefixes("  ").is_empty());
        // Each prefix's range holds every name starting with it, and nothing before it.
        let prefix = "2023 ";
        let after = just_before(prefix);
        let before = format!("{prefix}\u{10FFFF}");
        for name in ["2023 Ohio WSO Championships", "2023 A"] {
            assert!(after.as_str() < name && name < before.as_str(), "{name}");
        }
        for name in ["2022 Zeta", "2023", "2024 Ohio"] {
            assert!(!(after.as_str() < name && name < before.as_str()), "{name}");
        }
    }

    #[test]
    fn edit_distance_counts_characters() {
        assert_eq!(edit_distance("kitten", "sitting"), 3);
        assert_eq!(edit_distance("", "abc"), 3);
        assert_eq!(edit_distance("same", "same"), 0);
    }
}
