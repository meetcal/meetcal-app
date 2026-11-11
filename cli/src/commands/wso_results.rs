use std::collections::HashSet;

use anyhow::{Result, anyhow, bail};
use clap::Parser;
use serde_json::json;

use crate::commands::club_results::{meet_has_only_results, report, results_only_message};
use crate::types::athletes::Athletes;
use crate::types::club::ClubMeetStats;
use crate::utils::backend::{queries, query};
use crate::utils::names::{NameKind, not_found};
use crate::utils::output;
use crate::utils::stats::fold;

/// Get full meet results for a given WSO.
#[derive(Parser)]
#[command(
    name = "wso",
    after_help = r#"Examples:
  meetcal wso "2026 Masters National Championships & National University Championships" --wso Carolina"#
)]
pub struct WsoResultsArgs {
    /// Meet to search for
    #[arg(value_parser = crate::utils::filters::parse_name)]
    pub meet: String,

    /// WSO to search for
    #[arg(long, short = 'w', value_parser = crate::utils::filters::parse_name)]
    pub wso: String,
}

#[derive(Debug, PartialEq)]
pub struct WsoAthletes {
    pub total_athletes: usize,
    pub names: Vec<String>,
}

pub async fn run(args: WsoResultsArgs) -> Result<()> {
    let stats = get_wso_meet_stats(&args.wso, &args.meet).await?;
    if stats.total_athletes == 0 {
        return Err(nobody_registered(&args.wso, &args.meet).await);
    }
    output::emit(report("WSO", &args.wso, &args.meet, &stats));
    Ok(())
}

pub async fn get_wso_meet_stats(wso: &str, meet: &str) -> Result<ClubMeetStats> {
    query(
        queries::WSO_MEET_STATS,
        &json!({ "wso": wso, "meet": meet }),
    )
    .await
}

async fn nobody_registered(wso: &str, meet: &str) -> anyhow::Error {
    if meet_has_only_results(meet).await {
        return anyhow!(results_only_message("wso", meet));
    }
    let roster = match get_meet_roster(meet).await {
        Ok(roster) => roster,
        Err(error) => return error,
    };
    match select_wso_athletes(&roster, wso, meet) {
        Err(error) => error,
        Ok(_) => anyhow!("No athletes found for WSO \"{wso}\" in meet \"{meet}\"."),
    }
}

pub async fn get_meet_roster(meet: &str) -> Result<Vec<Athletes>> {
    let query_args = json!({ "meet": meet });
    let athletes: Vec<Athletes> = query(queries::MEET_ATHLETES, &query_args).await?;
    if athletes.is_empty() {
        let message = format!("No athletes found for meet \"{meet}\"");
        return Err(not_found(NameKind::Meet, meet, message).await);
    }
    Ok(athletes)
}

pub fn select_wso_athletes(athletes: &[Athletes], wso: &str, meet: &str) -> Result<WsoAthletes> {
    if athletes.is_empty() {
        bail!("No athletes found for meet \"{meet}\"");
    }

    let normalized_wso = fold(wso);
    let mut seen_names = HashSet::new();
    let mut names = Vec::new();

    for athlete in athletes {
        if athlete.wso.as_deref().map(fold).as_deref() != Some(normalized_wso.as_str()) {
            continue;
        }

        let name = athlete.name.trim();
        if !name.is_empty() && seen_names.insert(fold(name)) {
            names.push(name.to_string());
        }
    }

    if names.is_empty() {
        let mut available_wsos: Vec<_> = athletes
            .iter()
            .filter_map(|athlete| athlete.wso.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect();
        available_wsos.sort_by_key(|value| fold(value));
        available_wsos.dedup_by(|left, right| fold(left) == fold(right));

        let suffix = if available_wsos.is_empty() {
            String::new()
        } else {
            format!(" Available WSOs: {}.", available_wsos.join(", "))
        };

        return Err(anyhow!(
            "No athletes found for WSO \"{wso}\" in meet \"{meet}\".{suffix}"
        ));
    }

    Ok(WsoAthletes {
        total_athletes: athletes.len(),
        names,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn athlete(name: &str, wso: Option<&str>) -> Athletes {
        Athletes {
            adaptive: false,
            age: 25.0,
            club: "Club".to_string(),
            entry_total: 200.0,
            gender: "Female".to_string(),
            meet: "Meet".to_string(),
            member_id: "1".to_string(),
            name: name.to_string(),
            session_number: None,
            session_platform: None,
            weight_class: "69".to_string(),
            wso: wso.map(str::to_string),
            date: None,
            weigh_in_time: None,
            start_time: None,
        }
    }

    #[test]
    fn names_fold_ignoring_case_and_repeated_whitespace() {
        assert_eq!(fold("  Mountain   South "), "mountain south");
    }

    #[test]
    fn selects_wso_case_insensitively_and_deduplicates_names() {
        let athletes = vec![
            athlete(" Jane Doe ", Some("Mountain South")),
            athlete("jane   doe", Some(" mountain   south ")),
            athlete("John Doe", Some("Florida")),
        ];

        let selected = select_wso_athletes(&athletes, "MOUNTAIN SOUTH", "Meet").unwrap();

        assert_eq!(selected.total_athletes, 3);
        assert_eq!(selected.names, vec!["Jane Doe"]);
    }

    #[test]
    fn selection_error_lists_available_wsos() {
        let athletes = vec![
            athlete("Jane", Some("Florida")),
            athlete("John", Some("Carolina")),
            athlete("Jess", Some(" florida ")),
        ];

        let error = select_wso_athletes(&athletes, "Ohio", "Meet")
            .unwrap_err()
            .to_string();

        assert!(error.contains("No athletes found for WSO \"Ohio\""));
        assert!(error.contains("Available WSOs: Carolina, Florida"));
    }

    #[test]
    fn selection_distinguishes_empty_meet_from_missing_wso() {
        let error = select_wso_athletes(&[], "Carolina", "Missing Meet")
            .unwrap_err()
            .to_string();

        assert_eq!(error, "No athletes found for meet \"Missing Meet\"");
    }
}
