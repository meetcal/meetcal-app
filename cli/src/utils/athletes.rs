//! Athletes' full result histories, and every result in a date range.

use std::collections::HashMap;

use anyhow::{Context, Result, anyhow};
use chrono::{Datelike, NaiveDate};
use serde::Deserialize;
use serde_json::json;
use tokio::task::JoinSet;

use crate::types::lifting_results::LiftingResults;
use crate::types::wrapped::SearchResponse;
use crate::utils::backend::{Page, collect_pages, queries, query};
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

/// Date slices of a range read side by side. Each slice is its own cursor chain, so a year's
/// 15 pages are not read one after another.
pub const RESULTS_CONCURRENCY: usize = 8;

/// Every result dated `from` to `to` (inclusive, `YYYY-MM-DD`), oldest first. The range is read
/// a month at a time, [`RESULTS_CONCURRENCY`] months at once, each a page at a time (at most
/// `backend::MAX_PAGES` pages a month). `progress` is told the running count as each month
/// arrives.
pub async fn results_between(
    from: &str,
    to: &str,
    mut progress: impl FnMut(usize),
) -> Result<Vec<LiftingResults>> {
    let parse = |value: &str| {
        NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .with_context(|| format!("Expected a date as YYYY-MM-DD, not \"{value}\""))
    };
    let slices = month_slices(parse(from)?, parse(to)?);
    let mut pending = slices.iter().cloned().enumerate();
    let mut tasks = JoinSet::new();
    for (index, (start, end)) in pending.by_ref().take(RESULTS_CONCURRENCY) {
        tasks.spawn(async move { (index, results_in_slice(start, end).await) });
    }
    let mut by_slice: Vec<Vec<LiftingResults>> = vec![Vec::new(); slices.len()];
    let mut count = 0;
    while let Some(joined) = tasks.join_next().await {
        let (index, rows) = joined.context("A results read stopped unexpectedly")?;
        let rows = rows?;
        count += rows.len();
        by_slice[index] = rows;
        progress(count);
        if let Some((index, (start, end))) = pending.next() {
            tasks.spawn(async move { (index, results_in_slice(start, end).await) });
        }
    }
    Ok(by_slice.into_iter().flatten().collect())
}

/// Every result of one slice, `start` to `end` inclusive.
async fn results_in_slice(start: NaiveDate, end: NaiveDate) -> Result<Vec<LiftingResults>> {
    let (start, end) = (iso(start), iso(end));
    collect_pages(queries::RESULTS_PAGE.function, |cursor| {
        let (start, end) = (start.clone(), end.clone());
        async move {
            let page: ResultsPage = query(
                queries::RESULTS_PAGE,
                &json!({
                    "startDate": start,
                    "endDate": end,
                    "cursor": cursor,
                    "numItems": RESULTS_PAGE_SIZE,
                }),
            )
            .await?;
            Ok(Page {
                json: page.json,
                cursor: page.continue_cursor,
                is_done: page.is_done,
            })
        }
    })
    .await
}

fn iso(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

/// `from` to `to` (inclusive) cut at each month's end: the slices cover every day once, each
/// starting the day after the last ends. Empty when `to` is before `from`.
pub fn month_slices(from: NaiveDate, to: NaiveDate) -> Vec<(NaiveDate, NaiveDate)> {
    let mut slices = Vec::new();
    let mut start = from;
    while start <= to {
        let next_month = if start.month() == 12 {
            NaiveDate::from_ymd_opt(start.year() + 1, 1, 1)
        } else {
            NaiveDate::from_ymd_opt(start.year(), start.month() + 1, 1)
        };
        let month_end = next_month.and_then(|next| next.pred_opt()).unwrap_or(to);
        let end = month_end.min(to);
        slices.push((start, end));
        match end.succ_opt() {
            Some(next) => start = next,
            None => break,
        }
    }
    slices
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn month_slices_cover_the_range_without_gaps_or_overlaps() {
        for (from, to) in [
            ("2025-01-01", "2025-12-31"),
            ("2024-02-10", "2024-03-05"),
            ("2026-06-01", "2026-06-30"),
            ("2026-06-15", "2026-06-15"),
            ("2023-11-30", "2025-01-01"),
        ] {
            let slices = month_slices(date(from), date(to));
            assert_eq!(slices.first().unwrap().0, date(from));
            assert_eq!(slices.last().unwrap().1, date(to));
            for (start, end) in &slices {
                assert!(start <= end);
                assert_eq!(start.month(), end.month(), "{start} to {end}");
            }
            for pair in slices.windows(2) {
                assert_eq!(pair[0].1.succ_opt().unwrap(), pair[1].0);
            }
        }
        assert_eq!(
            month_slices(date("2025-01-01"), date("2025-12-31")).len(),
            12
        );
        assert_eq!(
            month_slices(date("2024-02-10"), date("2024-03-05")),
            [
                (date("2024-02-10"), date("2024-02-29")),
                (date("2024-03-01"), date("2024-03-05"))
            ]
        );
        assert!(month_slices(date("2025-02-01"), date("2025-01-01")).is_empty());
    }

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
