//! Athletes' full result histories, and every result in a date range.

use std::collections::HashMap;

use anyhow::{Result, anyhow};
use serde::Deserialize;
use serde_json::json;

use crate::types::lifting_results::LiftingResults;
use crate::types::wrapped::SearchResponse;
use crate::utils::backend::{queries, query};
use crate::utils::names::MAX_SUGGESTIONS;
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

/// The error for an athlete with no results: MeetCal's name suggestions for `name`, if any.
pub async fn unknown_athlete(name: &str) -> anyhow::Error {
    let message = format!("No results found for athlete \"{name}\"");
    let Ok(search) = query::<SearchResponse, _>(queries::SEARCH, &json!({ "query": name })).await
    else {
        return anyhow!(message);
    };
    let suggestions: Vec<String> = search
        .suggestions
        .into_iter()
        .filter(|suggestion| fold(suggestion) != fold(name))
        .take(MAX_SUGGESTIONS)
        .map(|suggestion| format!("  {suggestion}"))
        .collect();
    if suggestions.is_empty() {
        anyhow!(message)
    } else {
        anyhow!("{message}\nDid you mean:\n{}", suggestions.join("\n"))
    }
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
