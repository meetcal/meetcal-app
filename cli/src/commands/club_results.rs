use anyhow::{Result, bail};
use clap::Parser;
use comfy_table::Table;

use crate::types::club::ClubMeetStats;
use crate::utils::backend::get_json;

/// Analyze club performance stats for a meet.
///
/// Examples:
///   meetcal club-results --club "POWER AND GRACE PERFORMANCE." --meet "2025 UMWF World Championships"
#[derive(Parser)]
#[command(name = "club-results")]
pub struct ClubResultsArgs {
    /// Club name
    #[arg(long, short = 'c')]
    pub club: String,

    /// Meet name
    #[arg(long, short = 'm')]
    pub meet: String,
}

pub async fn run(args: ClubResultsArgs) -> Result<()> {
    let stats = get_club_meet_stats(&args.club, &args.meet).await?;
    validate_stats(&stats, &args.club, &args.meet)?;
    println!("{}", render_report(&args.club, &args.meet, &stats));
    Ok(())
}

pub async fn get_club_meet_stats(club: &str, meet: &str) -> Result<ClubMeetStats> {
    get_json("/clubs/meet-stats", &[("club", club), ("meet", meet)]).await
}

pub fn validate_stats(stats: &ClubMeetStats, club: &str, meet: &str) -> Result<()> {
    if stats.total_athletes == 0 {
        bail!("No athletes found for club \"{club}\" in meet \"{meet}\"");
    }

    Ok(())
}

pub fn render_report(club: &str, meet: &str, stats: &ClubMeetStats) -> String {
    let mut summary = Table::new();
    summary.set_header(vec!["Club", "Meet", "Athletes", "Results"]);
    summary.add_row(vec![
        club.to_string(),
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
        format!("{}kg", format_weight(stats.total_weight_lifted)),
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

    let mut sections = vec![
        "PERFORMANCE STATISTICS".to_string(),
        summary.to_string(),
        "RESULTS".to_string(),
        performance.to_string(),
        "MEDALS".to_string(),
        medals.to_string(),
    ];

    if !stats.athlete_results.is_empty() {
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
                result.weight_class.clone(),
                format_weight(result.body_weight),
                format_weight(result.snatch_best),
                format_weight(result.cj_best),
                format_weight(result.total),
                yes_no(result.is_pr),
                yes_no(result.perfect_lifts),
                medal_name(result.snatch_medal.as_deref()),
                medal_name(result.cj_medal.as_deref()),
                medal_name(result.total_medal.as_deref()),
            ]);
        }

        sections.push("ATHLETE RESULTS".to_string());
        sections.push(athletes.to_string());
    }

    sections.join("\n")
}

fn yes_no(value: bool) -> String {
    if value { "Yes" } else { "No" }.to_string()
}

fn medal_name(medal: Option<&str>) -> String {
    medal
        .map(|value| {
            let mut characters = value.chars();
            match characters.next() {
                Some(first) => first.to_uppercase().collect::<String>() + characters.as_str(),
                None => String::new(),
            }
        })
        .unwrap_or_else(|| "-".to_string())
}

fn format_weight(value: f64) -> String {
    if value == 0.0 {
        return "0".to_string();
    }

    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        format!("{value:.2}")
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_string()
    }
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
            medal: Some("gold".to_string()),
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
    fn report_omits_athlete_table_when_results_are_not_available() {
        let mut no_results = stats();
        no_results.athlete_results.clear();

        let report = render_report("Test Club", "Upcoming Meet", &no_results);

        assert!(report.contains("PERFORMANCE STATISTICS"));
        assert!(!report.contains("ATHLETE RESULTS"));
    }

    #[test]
    fn formats_fractional_and_whole_weights_without_noise() {
        assert_eq!(format_weight(187.5), "187.5");
        assert_eq!(format_weight(200.0), "200");
        assert_eq!(format_weight(82.25), "82.25");
        assert_eq!(format_weight(-0.0), "0");
    }

    #[test]
    fn formats_missing_and_present_medals() {
        assert_eq!(medal_name(None), "-");
        assert_eq!(medal_name(Some("bronze")), "Bronze");
        assert_eq!(medal_name(Some("")), "");
    }
}
