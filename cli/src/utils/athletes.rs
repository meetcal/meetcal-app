//! Athletes' full result histories, and every result in a date range.

use std::collections::HashMap;

use anyhow::{Result, anyhow};
use serde::Deserialize;
use serde_json::json;

use crate::types::lifting_results::LiftingResults;
use crate::types::wrapped::SearchResponse;
use crate::utils::backend::{queries, query};
use crate::utils::names::{MAX_SUGGESTIONS, closest};
use crate::utils::stats::fold;

/// Names per `results:byNames` call (the query takes at most 100).
pub const HISTORY_BATCH_SIZE: usize = 50;

/// Rows per `results:page` call.
pub const RESULTS_PAGE_SIZE: u32 = 2000;

/// Every result of the athlete named `name` (case and spacing ignored). An unknown name is an
/// error naming the closest athletes MeetCal has.
pub async fn history(name: &str) -> Result<Vec<LiftingResults>> {
    let rows: Vec<LiftingResults> =
        query(queries::RESULTS_BY_NAMES, &json!({ "names": [name] })).await?;
    let wanted = fold(name);
    let rows: Vec<LiftingResults> = rows
        .into_iter()
        .filter(|row| fold(&row.name) == wanted)
        .collect();
    if !rows.is_empty() {
        return Ok(rows);
    }
    Err(unknown_athlete(name).await)
}

/// The error for an athlete with no results, with the names MeetCal has that are closest to
/// `name`.
pub async fn unknown_athlete(name: &str) -> anyhow::Error {
    let message = format!("No results found for athlete \"{name}\"");
    let candidates = athlete_candidates(name).await;
    let close = closest(name, &candidates, MAX_SUGGESTIONS);
    if close.is_empty() {
        anyhow!(message)
    } else {
        let list: Vec<String> = close.iter().map(|name| format!("  {name}")).collect();
        anyhow!("{message}\nDid you mean:\n{}", list.join("\n"))
    }
}

/// Searches a misspelled name is still likely to match: the whole name, the name up to the last
/// word's first three letters, and its first and last words alone. MeetCal's name search matches
/// substrings, so a typo anywhere defeats the whole name but rarely all of these.
pub fn search_pieces(name: &str) -> Vec<String> {
    let words: Vec<&str> = name.split_whitespace().collect();
    let mut pieces = vec![words.join(" ")];
    if let Some((last, rest)) = words.split_last()
        && !rest.is_empty()
    {
        let prefix: String = last.chars().take(3).collect();
        pieces.push(format!("{} {prefix}", rest.join(" ")));
        pieces.push(last.to_string());
        pieces.push(rest[0].to_string());
    }
    pieces.retain(|piece| piece.chars().count() >= 3);
    pieces.dedup();
    pieces
}

async fn athlete_candidates(name: &str) -> Vec<String> {
    let mut candidates: Vec<String> = Vec::new();
    for piece in search_pieces(name) {
        if let Ok(search) =
            query::<SearchResponse, _>(queries::SEARCH, &json!({ "query": piece })).await
        {
            for suggestion in search.suggestions {
                if fold(&suggestion) != fold(name) && !candidates.contains(&suggestion) {
                    candidates.push(suggestion);
                }
            }
        }
    }
    candidates
}

/// Every result of each of `names`, keyed by folded name. Names with no results are absent.
pub async fn histories(names: &[String]) -> Result<HashMap<String, Vec<LiftingResults>>> {
    let mut by_name: HashMap<String, Vec<LiftingResults>> = HashMap::new();
    for batch in names.chunks(HISTORY_BATCH_SIZE) {
        let rows: Vec<LiftingResults> =
            query(queries::RESULTS_BY_NAMES, &json!({ "names": batch })).await?;
        for row in rows {
            by_name.entry(fold(&row.name)).or_default().push(row);
        }
    }
    Ok(by_name)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResultsPage {
    json: String,
    is_done: bool,
    continue_cursor: String,
}

/// Every result dated `from` to `to` (inclusive, `YYYY-MM-DD`), oldest first, read a page at a
/// time. `progress` is told the running count after each page.
pub async fn results_between(
    from: &str,
    to: &str,
    mut progress: impl FnMut(usize),
) -> Result<Vec<LiftingResults>> {
    let mut rows = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let page: ResultsPage = query(
            queries::RESULTS_PAGE,
            &json!({
                "startDate": from,
                "endDate": to,
                "cursor": cursor,
                "numItems": RESULTS_PAGE_SIZE,
            }),
        )
        .await?;
        let mut batch: Vec<LiftingResults> = serde_json::from_str(&page.json)?;
        rows.append(&mut batch);
        progress(rows.len());
        if page.is_done {
            return Ok(rows);
        }
        cursor = Some(page.continue_cursor);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_pieces_survive_a_typo_in_any_word() {
        assert_eq!(
            search_pieces("Brandon Victorain"),
            ["Brandon Victorain", "Brandon Vic", "Victorain", "Brandon"]
        );
        assert_eq!(search_pieces("Ada"), ["Ada"]);
        assert!(search_pieces("  ").is_empty());
    }
}
