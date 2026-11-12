use anyhow::{Result, bail};
use clap::Parser;
use comfy_table::Table;

use crate::types::club::ClubMeetStats;
use crate::utils::backend::{queries, query};
use crate::utils::format::{NO_VALUE, capitalized, display_body_weight, display_weight_class};
use crate::utils::meet_names::result_meet_aliases;
use crate::utils::names::{NameKind, clubs, not_found, not_found_message};
use crate::utils::output::{self, Report};
use crate::utils::stats::number;

/// Analyze club performance stats for a meet.
#[derive(Parser)]
#[command(
    name = "club-results",
    after_help = r#"Examples:
  meetcal club-results --club "Jacksonville Weightlifting" --meet "2026 Florida State Championships (WSO Championships)""#
)]
pub struct ClubResultsArgs {
    /// Club name
    #[arg(long, short = 'c', value_parser = crate::utils::filters::parse_name)]
    pub club: String,

    /// Meet name
    #[arg(long, short = 'm', value_parser = crate::utils::filters::parse_name)]
    pub meet: String,
}

pub async fn run(args: ClubResultsArgs) -> Result<()> {
    let club = args.club.as_str();
    let meet = args.meet.as_str();
    let stats = get_club_meet_stats(club, meet).await?;
    if let Err(error) = validate_stats(&stats, club, meet) {
        let message = error.to_string();
        let clubs = clubs().await.unwrap_or_default();
        if !clubs.is_empty() && !club_known(&clubs, club) {
            bail!(not_found_message(NameKind::Club, club, &clubs, message));
        }
        if meet_has_only_results(meet).await {
            bail!(results_only_message("club-results", meet));
        }
        return Err(not_found(NameKind::ResultsMeet, meet, message).await);
    }
    refuse_uncounted_results("Club", club, meet, &stats).await?;
    output::emit(report("Club", club, meet, &stats));
    Ok(())
}

pub(crate) async fn refuse_uncounted_results(
    group: &str,
    name: &str,
    meet: &str,
    stats: &ClubMeetStats,
) -> Result<()> {
    if !stats.athlete_results.is_empty() {
        return Ok(());
    }
    let titles = results_under_other_names(meet).await;
    match uncounted_results_message(group, name, meet, stats.total_athletes, &titles) {
        Some(message) => bail!(message),
        None => Ok(()),
    }
}

async fn results_under_other_names(meet: &str) -> Vec<String> {
    let mut titles = Vec::new();
    for alias in result_meet_aliases(meet) {
        if alias == meet {
            continue;
        }
        let rows: Result<Vec<serde_json::Value>> =
            query(queries::MEET_RESULTS, &serde_json::json!({ "meet": alias })).await;
        if matches!(rows, Ok(ref rows) if !rows.is_empty()) {
            titles.push(alias);
        }
    }
    titles
}

pub(crate) fn uncounted_results_message(
    group: &str,
    name: &str,
    meet: &str,
    athletes: u64,
    titles_with_results: &[String],
) -> Option<String> {
    let first = titles_with_results.first()?;
    let quoted: Vec<String> = titles_with_results
        .iter()
        .map(|title| format!("\"{title}\""))
        .collect();
    let athletes = match athletes {
        1 => "1 athlete".to_string(),
        count => format!("{count} athletes"),
    };
    Some(format!(
        "{group} \"{name}\" has {athletes} registered for meet \"{meet}\", and none of \
         their results are counted there, while MeetCal holds results under {}. If those are this \
         meet's results, they are not linked to it yet.\n\
         See them with: meetcal meet-results \"{first}\"",
        quoted.join(" and ")
    ))
}

/// Whether `club` is a known club exactly as the stats query was given it: the query matches
/// the name exactly, so a name differing in case or spacing is a club to suggest.
pub(crate) fn club_known(clubs: &[String], club: &str) -> bool {
    clubs.iter().any(|known| known == club)
}

pub(crate) async fn meet_has_only_results(meet: &str) -> bool {
    let roster: Result<Vec<serde_json::Value>> =
        query(queries::MEET_ATHLETES, &serde_json::json!({ "meet": meet })).await;
    matches!(roster, Ok(ref athletes) if athletes.is_empty()) && meet_has_results(meet).await
}

pub(crate) async fn meet_has_results(meet: &str) -> bool {
    for alias in result_meet_aliases(meet) {
        let rows: Result<Vec<serde_json::Value>> =
            query(queries::MEET_RESULTS, &serde_json::json!({ "meet": alias })).await;
        if matches!(rows, Ok(ref rows) if !rows.is_empty()) {
            return true;
        }
    }
    false
}

pub(crate) fn results_only_message(command: &str, meet: &str) -> String {
    format!(
        "{command} needs the start list of meet \"{meet}\", and MeetCal has only its results.\n\
         See them with: meetcal meet-results \"{meet}\""
    )
}

pub(crate) async fn get_club_meet_stats(club: &str, meet: &str) -> Result<ClubMeetStats> {
    query(
        queries::CLUB_MEET_STATS,
        &serde_json::json!({ "club": club, "meet": meet }),
    )
    .await
}

pub(crate) fn validate_stats(stats: &ClubMeetStats, club: &str, meet: &str) -> Result<()> {
    if stats.total_athletes == 0 {
        bail!("No athletes found for club \"{club}\" in meet \"{meet}\"");
    }

    Ok(())
}

#[cfg(test)]
fn render_report(club: &str, meet: &str, stats: &ClubMeetStats) -> String {
    report("Club", club, meet, stats).to_text()
}

pub(crate) fn report(group: &str, name: &str, meet: &str, stats: &ClubMeetStats) -> Report {
    let mut summary = Table::new();
    summary.set_header(vec![group, "Meet", "Athletes", "Results"]);
    summary.add_row(vec![
        name.to_string(),
        meet.to_string(),
        stats.total_athletes.to_string(),
        stats.athlete_results.len().to_string(),
    ]);

    let mut performance = Table::new();
    performance.set_header(vec![
        "Total Weight Lifted",
        "Snatch Make Rate",
        "C&J Make Rate",
        "Overall Make Rate",
        "Total PRs",
        "6 for 6",
    ]);
    performance.add_row(vec![
        format!("{}kg", number(stats.total_weight_lifted)),
        format!("{}%", stats.snatch_make_rate),
        format!("{}%", stats.cj_make_rate),
        format!("{}%", stats.combined_make_rate),
        stats.total_prs.to_string(),
        stats.perfect_6_for_6.to_string(),
    ]);

    let mut medals = Table::new();
    medals.set_header(vec!["Gold", "Silver", "Bronze", "Total"]);
    medals.add_row(vec![
        stats.gold_medals,
        stats.silver_medals,
        stats.bronze_medals,
        stats.gold_medals + stats.silver_medals + stats.bronze_medals,
    ]);

    let mut report = Report::new()
        .headed("summary", "PERFORMANCE STATISTICS", summary)
        .headed("results", "RESULTS", performance)
        .headed("medals", "MEDALS", medals);

    {
        let mut athletes = Table::new();
        athletes.set_header(vec![
            "Athlete",
            "Class",
            "BW",
            "Snatch",
            "C&J",
            "Total",
            "PR",
            "6 for 6",
            "Snatch Medal",
            "C&J Medal",
            "Total Medal",
        ]);

        for result in &stats.athlete_results {
            athletes.add_row(vec![
                result.name.clone(),
                display_weight_class(&result.weight_class),
                display_body_weight(result.body_weight),
                number(result.snatch_best),
                number(result.cj_best),
                number(result.total),
                yes_no(result.is_pr),
                yes_no(result.perfect_lifts),
                medal_name(result.snatch_medal.as_deref()),
                medal_name(result.cj_medal.as_deref()),
                medal_name(result.total_medal.as_deref()),
            ]);
        }

        report = report.headed_if_any("athletes", "ATHLETE RESULTS", athletes);
    }

    report
}

fn yes_no(value: bool) -> String {
    if value { "Yes" } else { "No" }.to_string()
}

fn medal_name(medal: Option<&str>) -> String {
    medal
        .map(capitalized)
        .unwrap_or_else(|| NO_VALUE.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::club::AthleteMeetResult;

    fn athlete_result() -> AthleteMeetResult {
        AthleteMeetResult {
            name: "Jane Doe".to_string(),
            weight_class: "69".to_string(),
            snatch_best: 82.5,
            cj_best: 105.0,
            total: 187.5,
            body_weight: 68.4,
            snatch_medal: Some("silver".to_string()),
            cj_medal: None,
            total_medal: Some("gold".to_string()),
            is_pr: true,
            perfect_lifts: false,
        }
    }

    fn stats() -> ClubMeetStats {
        ClubMeetStats {
            total_athletes: 2,
            gold_medals: 1,
            silver_medals: 1,
            bronze_medals: 0,
            total_prs: 1,
            perfect_6_for_6: 0,
            total_weight_lifted: 387.5,
            snatch_make_rate: 83,
            cj_make_rate: 67,
            combined_make_rate: 75,
            athlete_results: vec![athlete_result()],
        }
    }

    #[test]
    fn a_club_is_known_only_as_the_query_was_given_it() {
        let clubs = vec!["Florida".to_string()];
        assert!(club_known(&clubs, "Florida"));
        assert!(!club_known(&clubs, " Florida "));
        assert!(!club_known(&clubs, "florida"));
    }

    #[test]
    fn parses_backend_response_contract() {
        let json = r#"{
            "total_athletes": 2,
            "gold_medals": 1,
            "silver_medals": 1,
            "bronze_medals": 0,
            "total_prs": 1,
            "perfect_6_for_6": 1,
            "total_weight_lifted": 387.5,
            "snatch_make_rate": 83,
            "cj_make_rate": 67,
            "combined_make_rate": 75,
            "athlete_results": [{
                "name": "Jane Doe",
                "weight_class": "69",
                "snatch_best": 82.5,
                "cj_best": 105.0,
                "total": 187.5,
                "body_weight": 68.4,
                "medal": "gold",
                "snatch_medal": "silver",
                "cj_medal": null,
                "total_medal": "gold",
                "is_pr": true,
                "perfect_lifts": false
            }]
        }"#;

        let parsed: ClubMeetStats = serde_json::from_str(json).unwrap();

        assert_eq!(parsed.total_weight_lifted, 387.5);
        assert_eq!(parsed.perfect_6_for_6, 1);
        assert_eq!(parsed.athlete_results[0].snatch_best, 82.5);
        assert_eq!(parsed.athlete_results[0].cj_medal, None);
    }

    #[test]
    fn rejects_response_missing_required_backend_field() {
        let json = r#"{"total_athletes": 1}"#;

        assert!(serde_json::from_str::<ClubMeetStats>(json).is_err());
    }

    #[test]
    fn zero_athletes_returns_contextual_error() {
        let mut empty = stats();
        empty.total_athletes = 0;

        let error = validate_stats(&empty, "Unknown Club", "Test Meet")
            .unwrap_err()
            .to_string();

        assert_eq!(
            error,
            "No athletes found for club \"Unknown Club\" in meet \"Test Meet\""
        );
    }

    #[test]
    fn a_results_only_meet_points_to_meet_results_not_other_meets() {
        let message = results_only_message("club-results", "2025 UMWF World Championships");

        assert!(message.starts_with("club-results needs the start list"));
        assert!(results_only_message("wso", "M").starts_with("wso needs the start list"));
        assert!(message.contains("meetcal meet-results \"2025 UMWF World Championships\""));
        assert!(!message.contains("Did you mean"));
    }

    #[test]
    fn athletes_without_counted_results_at_a_meet_with_results_elsewhere_are_explained() {
        let titles = vec![
            "The 2026 USA Weightlifting Masters National Championships Powered by Rogue Fitness"
                .to_string(),
            "The 2026 National University Championships".to_string(),
        ];
        assert_eq!(
            uncounted_results_message("WSO", "Carolina", "2026 Masters & University", 12, &titles)
                .as_deref(),
            Some(
                "WSO \"Carolina\" has 12 athletes registered for meet \"2026 Masters & University\", \
                 and none of their results are counted there, while MeetCal holds results under \
                 \"The 2026 USA Weightlifting Masters National Championships Powered by Rogue \
                 Fitness\" and \"The 2026 National University Championships\". If those are this \
                 meet's results, they are not linked to it yet.\nSee them with: meetcal meet-results \
                 \"The 2026 USA Weightlifting Masters National Championships Powered by Rogue \
                 Fitness\""
            )
        );
        assert_eq!(
            uncounted_results_message("Club", "Club", "Ohio Open", 3, &[]),
            None
        );
        assert!(
            uncounted_results_message("Club", "Barbell", "Meet", 1, &titles).is_some_and(
                |message| message.starts_with("Club \"Barbell\" has 1 athlete registered")
            )
        );
    }

    #[test]
    fn report_renders_summary_rates_medals_and_athlete_details() {
        let report = render_report("Test Club", "Test Meet", &stats());

        assert!(report.contains("Test Club"));
        assert!(report.contains("387.5kg"));
        assert!(report.contains("83%"));
        assert!(report.contains("ATHLETE RESULTS"));
        assert!(report.contains("Jane Doe"));
        assert!(report.contains("Silver"));
        assert!(report.contains("Gold"));
    }

    #[test]
    fn athletes_show_the_class_with_its_unit_and_a_dash_for_an_unrecorded_body_weight() {
        let mut unweighed = stats();
        unweighed.athlete_results[0].body_weight = 0.0;
        unweighed.athlete_results[0].weight_class = "+110".to_string();
        unweighed.athlete_results.push(athlete_result());
        let json = report("Club", "Test Club", "Test Meet", &unweighed).to_json();
        assert_eq!(json["athletes"][0]["class"], "110+kg");
        assert_eq!(json["athletes"][0]["bw"], serde_json::Value::Null);
        assert_eq!(json["athletes"][1]["class"], "69kg");
        assert_eq!(json["athletes"][1]["bw"], 68.4);
        let text = render_report("Test Club", "Test Meet", &unweighed);
        assert!(text.contains("| 110+kg "));
        assert!(text.contains("| —  "));
    }

    #[test]
    fn a_wso_report_is_the_club_report_under_a_wso_column() {
        let club = report("Club", "Test Club", "Test Meet", &stats()).to_json();
        let wso = report("WSO", "Carolina", "Test Meet", &stats()).to_json();
        assert_eq!(club["summary"][0]["club"], "Test Club");
        assert_eq!(wso["summary"][0]["wso"], "Carolina");
        assert!(wso["summary"][0].get("club").is_none());
        for table in ["results", "medals", "athletes"] {
            assert_eq!(wso[table], club[table], "{table}");
        }
    }

    #[test]
    fn report_omits_athlete_table_when_results_are_not_available() {
        let mut no_results = stats();
        no_results.athlete_results.clear();

        let report = render_report("Test Club", "Upcoming Meet", &no_results);

        assert!(report.contains("PERFORMANCE STATISTICS"));
        assert!(!report.contains("ATHLETE RESULTS"));
    }

    #[test]
    fn formats_fractional_and_whole_weights_without_noise() {
        assert_eq!(number(187.5), "187.5");
        assert_eq!(number(200.0), "200");
        assert_eq!(number(82.25), "82.25");
        assert_eq!(number(-0.0), "0");
    }

    #[test]
    fn formats_missing_and_present_medals() {
        assert_eq!(medal_name(None), NO_VALUE);
        assert_eq!(medal_name(Some("bronze")), "Bronze");
        assert_eq!(medal_name(Some("")), "");
    }
}
