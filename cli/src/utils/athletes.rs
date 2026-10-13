//! Athletes' full result histories, and every result in a date range.

use std::collections::HashMap;

use anyhow::{Context, Result, anyhow};
use chrono::{Datelike, Months, NaiveDate};
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
    let rows = rows_named(rows, name);
    if !rows.is_empty() {
        return Ok(rows);
    }
    Err(unknown_athlete(name).await)
}

/// The rows of the athlete named `name`, by the folded name (the server's rule, so a row written
/// with a decomposed accent still belongs to the athlete).
pub fn rows_named(rows: Vec<LiftingResults>, name: &str) -> Vec<LiftingResults> {
    let wanted = fold(name);
    rows.into_iter()
        .filter(|row| fold(&row.name) == wanted)
        .collect()
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

/// The most slices a range is read in. A range longer than this many months is read in slices
/// of several whole months, so a wide or sparse range (`--from 1900-01-01`) costs at most this
/// many first-page requests rather than one per month.
pub const MAX_RESULT_SLICES: u32 = 48;

/// Every result dated `from` to `to` (inclusive, `YYYY-MM-DD`), oldest first. The range is read
/// a month at a time (several months at a time past [`MAX_RESULT_SLICES`] months),
/// [`RESULTS_CONCURRENCY`] slices at once, each a page at a time (at most `backend::MAX_PAGES`
/// pages a slice). `progress` is told the running count as each slice arrives.
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

/// `from` to `to` (inclusive) cut at month ends: the slices cover every day once, each starting
/// the day after the last ends. A slice is one month, or, when the range spans more than
/// [`MAX_RESULT_SLICES`] months, the fewest whole months that keep the count within it. Empty
/// when `to` is before `from`.
pub fn month_slices(from: NaiveDate, to: NaiveDate) -> Vec<(NaiveDate, NaiveDate)> {
    if to < from {
        return Vec::new();
    }
    // At least 1, since `to` is not before `from`.
    let months = ((to.year() - from.year()) * 12 + to.month() as i32 - from.month() as i32 + 1)
        .unsigned_abs();
    let step = months.div_ceil(MAX_RESULT_SLICES);
    let mut slices = Vec::new();
    let mut start = from;
    while start <= to {
        let slice_end = start
            .with_day(1)
            .and_then(|first| first.checked_add_months(Months::new(step)))
            .and_then(|next| next.pred_opt())
            .unwrap_or(to);
        let end = slice_end.min(to);
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
    fn a_wide_range_is_read_in_at_most_max_result_slices() {
        for (from, to) in [
            ("1900-01-01", "2026-12-31"),
            ("2010-01-15", "2014-01-14"),
            ("2010-01-01", "2014-12-31"),
            ("0001-01-01", "9999-12-31"),
        ] {
            let slices = month_slices(date(from), date(to));
            assert!(slices.len() <= MAX_RESULT_SLICES as usize, "{from} to {to}");
            assert_eq!(slices.first().unwrap().0, date(from));
            assert_eq!(slices.last().unwrap().1, date(to));
            for pair in slices.windows(2) {
                assert_eq!(pair[0].1.succ_opt().unwrap(), pair[1].0);
                // Cut at month ends.
                assert_eq!(pair[1].0.day(), 1);
            }
        }
        // 127 years: slices of 32 months, the last one shorter.
        let slices = month_slices(date("1900-01-01"), date("2026-12-31"));
        assert_eq!(slices.len(), 48);
        assert_eq!(slices[0], (date("1900-01-01"), date("1902-08-31")));
        // Exactly MAX_RESULT_SLICES months still reads a month at a time.
        assert_eq!(
            month_slices(date("2021-01-01"), date("2024-12-31")).len(),
            48
        );
    }

    #[test]
    fn rows_written_with_a_decomposed_accent_belong_to_the_athlete() {
        use crate::utils::stats::tests::row;
        let lift = |name: &str| {
            row(
                name,
                "2026-01-01",
                "M",
                "Open Women's 64kg",
                63.0,
                [80.0, 0.0, 0.0],
                [100.0, 0.0, 0.0],
            )
        };
        let rows = vec![
            lift("Ze\u{301}lie Martin"),
            lift("Zélie Martin"),
            lift("Zelie Martin"),
        ];
        assert_eq!(rows_named(rows, "zélie  martin").len(), 2);
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
