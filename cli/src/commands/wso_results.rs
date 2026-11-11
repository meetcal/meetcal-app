use anyhow::{Result, anyhow};
use clap::Parser;
use serde_json::json;

use crate::commands::club_results::{meet_has_results, report, results_only_message};
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

pub async fn run(args: WsoResultsArgs) -> Result<()> {
    let stats: ClubMeetStats = query(
        queries::WSO_MEET_STATS,
        &json!({ "wso": args.wso, "meet": args.meet }),
    )
    .await?;
    if stats.total_athletes == 0 {
        return Err(nobody_registered(&args.wso, &args.meet).await);
    }
    output::emit(report("WSO", &args.wso, &args.meet, &stats));
    Ok(())
}

async fn nobody_registered(wso: &str, meet: &str) -> anyhow::Error {
    let roster: Vec<Athletes> = match query(queries::MEET_ATHLETES, &json!({ "meet": meet })).await
    {
        Ok(roster) => roster,
        Err(error) => return error,
    };
    if !roster.is_empty() {
        return anyhow!(no_athletes_message(&roster, wso, meet));
    }
    if meet_has_results(meet).await {
        return anyhow!(results_only_message("wso", meet));
    }
    let message = format!("No athletes found for meet \"{meet}\"");
    not_found(NameKind::Meet, meet, message).await
}

pub(crate) fn no_athletes_message(roster: &[Athletes], wso: &str, meet: &str) -> String {
    let mut wsos_at_the_meet: Vec<&str> = roster
        .iter()
        .filter_map(|athlete| athlete.wso.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect();
    wsos_at_the_meet.sort_by_key(|value| fold(value));
    wsos_at_the_meet.dedup_by(|left, right| fold(left) == fold(right));
    let suffix = if wsos_at_the_meet.is_empty() {
        String::new()
    } else {
        format!(" Available WSOs: {}.", wsos_at_the_meet.join(", "))
    };
    format!("No athletes found for WSO \"{wso}\" in meet \"{meet}\".{suffix}")
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
    fn nobody_from_a_wso_lists_the_wsos_at_the_meet_once_each() {
        let roster = vec![
            athlete("Jane", Some("Florida")),
            athlete("John", Some("Carolina")),
            athlete("Jess", Some(" florida ")),
            athlete("Jo", None),
        ];
        assert_eq!(
            no_athletes_message(&roster, "Ohio", "Meet"),
            "No athletes found for WSO \"Ohio\" in meet \"Meet\". Available WSOs: Carolina, Florida."
        );
    }

    #[test]
    fn a_roster_that_names_no_wso_lists_none() {
        let roster = vec![athlete("Jane", None)];
        assert_eq!(
            no_athletes_message(&roster, "Ohio", "Meet"),
            "No athletes found for WSO \"Ohio\" in meet \"Meet\"."
        );
    }
}
