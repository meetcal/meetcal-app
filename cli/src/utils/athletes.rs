//! Athletes' full result histories.

use std::collections::HashMap;

use anyhow::{Context, Result, anyhow};
use serde::Serialize;
use serde_json::json;

use crate::types::lifting_results::{
    AthleteAnswer, LifterCard, LifterChoice, LiftingResults, PrMarks,
};
use crate::types::wrapped::SearchResponse;
use crate::utils::backend::{queries, query, query_each};
use crate::utils::format::us_date;
use crate::utils::names::{MAX_SUGGESTIONS, closest};
use crate::utils::stats::fold;

pub(crate) const NAMES_PER_READ: usize = 50;

#[derive(Clone, Debug, Default, clap::Args)]
pub struct LifterPick {
    /// One lifter's results, by the id a shared name lists
    #[arg(long, value_name = "ID", conflicts_with = "other")]
    pub lifter: Option<String>,

    /// The name's results no one lifter holds
    #[arg(long)]
    pub other: bool,
}

impl LifterPick {
    fn names_one_lifter(&self) -> bool {
        self.lifter.is_some() || self.other
    }
}

#[derive(Serialize)]
struct AthleteArgs<'a> {
    name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    lifter: Option<&'a str>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    other: bool,
}

#[derive(Debug)]
pub(crate) struct AthleteHistory {
    pub(crate) lifter: Option<LifterCard>,
    pub(crate) rows: Vec<LiftingResults>,
    pub(crate) prs: PrMarks,
}

pub(crate) async fn history(name: &str, pick: &LifterPick) -> Result<AthleteHistory> {
    let args = AthleteArgs {
        name,
        lifter: pick.lifter.as_deref(),
        other: pick.other,
    };
    let answer: AthleteAnswer = query(queries::ATHLETE, &args).await?;
    match athlete_history(answer, pick)? {
        Some(history) => Ok(history),
        None => Err(unknown_athlete(name).await),
    }
}

pub(crate) fn athlete_history(
    answer: AthleteAnswer,
    pick: &LifterPick,
) -> Result<Option<AthleteHistory>> {
    match answer {
        AthleteAnswer::Choose {
            name,
            lifters,
            other_results,
        } => Err(anyhow!(shared_name(&name, &lifters, other_results))),
        AthleteAnswer::Results { lifter, json, prs } => {
            let rows: Vec<LiftingResults> =
                serde_json::from_str(&json).context("reading an athlete's results")?;
            if rows.is_empty() && lifter.is_none() && !pick.names_one_lifter() {
                return Ok(None);
            }
            Ok(Some(AthleteHistory { lifter, rows, prs }))
        }
    }
}

fn results_count(count: f64) -> String {
    if count == 1.0 {
        "1 result".to_owned()
    } else {
        format!("{count} results")
    }
}

pub(crate) fn shared_name(name: &str, lifters: &[LifterChoice], other_results: f64) -> String {
    let mut lines = vec![format!(
        "\"{name}\" could be more than one lifter. Run again with one of:"
    )];
    for choice in lifters {
        let mut about = vec![results_count(choice.results)];
        if !choice.latest_date.is_empty() {
            about.push(format!("latest {}", us_date(&choice.latest_date)));
        }
        let label = if choice.lifter.label.is_empty() {
            String::new()
        } else {
            format!("{}, ", choice.lifter.label)
        };
        lines.push(format!(
            "  --lifter {}  {label}{}",
            choice.lifter.id,
            about.join(", ")
        ));
    }
    if other_results > 0.0 {
        lines.push(format!(
            "  --other  {} no one lifter holds",
            results_count(other_results)
        ));
    }
    lines.join("\n")
}

/// The error for an athlete with no results, with the names MeetCal has that are closest to
/// `name`.
pub(crate) async fn unknown_athlete(name: &str) -> anyhow::Error {
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
pub(crate) fn search_pieces(name: &str) -> Vec<String> {
    let words: Vec<&str> = name.split_whitespace().collect();
    let mut pieces = vec![words.join(" ")];
    if let Some((last, rest)) = words.split_last()
        && let Some(first) = rest.first()
    {
        let prefix: String = last.chars().take(3).collect();
        pieces.push(format!("{} {prefix}", rest.join(" ")));
        pieces.push(last.to_string());
        pieces.push(first.to_string());
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

pub(crate) async fn histories(names: &[String]) -> Result<HashMap<String, Vec<LiftingResults>>> {
    let batches = names
        .chunks(NAMES_PER_READ)
        .map(|batch| json!({ "names": batch }))
        .collect();
    let mut by_name: HashMap<String, Vec<LiftingResults>> = HashMap::new();
    for rows in query_each::<Vec<LiftingResults>>(queries::RESULTS_BY_NAMES, batches).await? {
        for row in rows {
            by_name.entry(fold(&row.name)).or_default().push(row);
        }
    }
    Ok(by_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn choose() -> AthleteAnswer {
        serde_json::from_value(json!({
            "kind": "choose",
            "name": "Taylor Johnson",
            "lifters": [
                { "id": "24655", "name": "Taylor Johnson", "label": "Age 18 · Barbell Club", "results": 2, "latest_date": "2025-06-01" },
                { "id": "20730", "name": "Taylor Johnson", "label": "", "results": 1, "latest_date": "" },
            ],
            "other_results": 3,
        }))
        .unwrap()
    }

    fn empty() -> AthleteAnswer {
        serde_json::from_value(json!({
            "kind": "results",
            "lifter": null,
            "json": "[]",
            "prs": { "set": { "snatch": [], "cj": [], "total": [] }, "current": { "snatch": null, "cj": null, "total": null } },
        }))
        .unwrap()
    }

    #[test]
    fn a_shared_name_lists_each_lifter_with_the_flag_that_picks_them() {
        let error = athlete_history(choose(), &LifterPick::default()).unwrap_err();
        assert_eq!(
            error.to_string(),
            "\"Taylor Johnson\" could be more than one lifter. Run again with one of:\n  --lifter 24655  Age 18 · Barbell Club, 2 results, latest Jun 1, 2025\n  --lifter 20730  1 result\n  --other  3 results no one lifter holds"
        );
    }

    #[test]
    fn an_unknown_name_is_left_for_suggestions_unless_a_lifter_was_picked() {
        assert!(
            athlete_history(empty(), &LifterPick::default())
                .unwrap()
                .is_none()
        );
        let others = LifterPick {
            lifter: None,
            other: true,
        };
        assert!(athlete_history(empty(), &others).unwrap().is_some());
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
