use std::collections::HashSet;

use anyhow::Result;
use comfy_table::Table;
use serde::Deserialize;

use crate::commands::compare::{MetricComparison, MetricUnit, percent_change};
use crate::commands::wrapped::calculate_wrapped_stats;
use crate::types::lifting_results::LiftingResults;
use crate::types::wrapped::WrappedStats;
use crate::utils::backend::get_json;
use crate::utils::meet_names::equivalent_meets;

const RESULTS_REQUEST_BATCH_SIZE: usize = 50;

#[derive(Debug, Deserialize)]
pub struct ClubMembership {
    pub name: String,
    pub meet: String,
    pub club: String,
    pub gender: String,
    pub weight_class: String,
    pub member_id: String,
    pub entry_total: f64,
}

#[derive(Debug, PartialEq)]
pub struct GroupWrappedStats {
    pub athlete_count: usize,
    pub wrapped: WrappedStats,
}

pub async fn get_club_memberships(club: &str) -> Result<Vec<ClubMembership>> {
    get_json("/clubs/athletes", &[("club", club)]).await
}

pub async fn get_wso_memberships(wso: &str) -> Result<Vec<ClubMembership>> {
    get_json("/wsos/athletes", &[("wso", wso)]).await
}

pub async fn get_recent_results(
    names: &[String],
    cutoff_date: &str,
) -> Result<Vec<LiftingResults>> {
    let mut results = Vec::new();
    for batch in names.chunks(RESULTS_REQUEST_BATCH_SIZE) {
        let query = [
            ("names", batch.join(",")),
            ("cutoff_date", cutoff_date.to_string()),
        ];
        let mut rows: Vec<LiftingResults> = get_json("/lifting-results/recent", &query).await?;
        results.append(&mut rows);
    }
    Ok(results)
}

pub async fn get_club_results_since(
    club: &str,
    cutoff_date: &str,
) -> Result<(Vec<ClubMembership>, Vec<LiftingResults>)> {
    let memberships = get_club_memberships(club).await?;
    get_membership_results_since(memberships, cutoff_date).await
}

pub async fn get_wso_results_since(
    wso: &str,
    cutoff_date: &str,
) -> Result<(Vec<ClubMembership>, Vec<LiftingResults>)> {
    let memberships = get_wso_memberships(wso).await?;
    get_membership_results_since(memberships, cutoff_date).await
}

async fn get_membership_results_since(
    memberships: Vec<ClubMembership>,
    cutoff_date: &str,
) -> Result<(Vec<ClubMembership>, Vec<LiftingResults>)> {
    let mut seen = HashSet::new();
    let names: Vec<_> = memberships
        .iter()
        .filter_map(|membership| {
            let normalized = normalize(&membership.name);
            seen.insert(normalized).then(|| membership.name.clone())
        })
        .collect();
    let results = get_recent_results(&names, cutoff_date).await?;
    let filtered = filter_membership_results(&memberships, results);
    Ok((memberships, filtered))
}

pub fn filter_membership_results(
    memberships: &[ClubMembership],
    results: Vec<LiftingResults>,
) -> Vec<LiftingResults> {
    let represented_athletes: HashSet<_> = memberships
        .iter()
        .map(|membership| normalize(&membership.name))
        .collect();

    results
        .into_iter()
        .filter(|result| {
            let name = normalize(&result.name);
            represented_athletes.contains(&name)
                && memberships.iter().any(|membership| {
                    normalize(&membership.name) == name
                        && equivalent_meets(&membership.meet, &result.meet)
                })
        })
        .collect()
}

pub fn results_for_year(results: Vec<LiftingResults>, year: i32) -> Vec<LiftingResults> {
    let prefix = format!("{year:04}-");
    results
        .into_iter()
        .filter(|result| result.date.starts_with(&prefix))
        .collect()
}

pub fn split_comparison_years(
    results: Vec<LiftingResults>,
    previous_year: i32,
    current_year: i32,
) -> (Vec<LiftingResults>, Vec<LiftingResults>) {
    let previous_prefix = format!("{previous_year:04}-");
    let current_prefix = format!("{current_year:04}-");
    let mut previous = Vec::new();
    let mut current = Vec::new();

    for result in results {
        if result.date.starts_with(&previous_prefix) {
            previous.push(result);
        } else if result.date.starts_with(&current_prefix) {
            current.push(result);
        }
    }

    (previous, current)
}

pub fn calculate_group_stats(results: &[LiftingResults]) -> GroupWrappedStats {
    let athlete_count = results
        .iter()
        .map(|result| normalize(&result.name))
        .collect::<HashSet<_>>()
        .len();

    GroupWrappedStats {
        athlete_count,
        wrapped: calculate_wrapped_stats(results),
    }
}

pub fn render_group_wrapped(
    group_kind: &str,
    group_name: &str,
    year: i32,
    stats: &GroupWrappedStats,
) -> String {
    let mut overview = Table::new();
    overview.set_header(vec!["Athletes", "Meets", "Make Rate", "Average Total"]);
    overview.add_row(vec![
        stats.athlete_count.to_string(),
        stats.wrapped.total_meets.to_string(),
        format!("{:.1}%", stats.wrapped.make_percentage),
        format!("{}kg", format_number(stats.wrapped.average_total)),
    ]);

    let mut lifts = Table::new();
    lifts.set_header(vec![
        "Total Weight Lifted",
        "Best Snatch",
        "Best C&J",
        "Best Total",
    ]);
    lifts.add_row(vec![
        format!("{}kg", format_number(stats.wrapped.total_weight_lifted)),
        format!("{}kg", format_number(stats.wrapped.best_snatch)),
        format!("{}kg", format_number(stats.wrapped.best_clean_jerk)),
        format!("{}kg", format_number(stats.wrapped.best_total)),
    ]);

    let mut top = Table::new();
    top.set_header(vec!["Top Meet (Best Total)"]);
    top.add_row(vec![
        stats
            .wrapped
            .top_meet
            .clone()
            .unwrap_or_else(|| "N/A".to_string()),
    ]);

    format!(
        "{year} {} WRAPPED — {group_name}\n{overview}\n{lifts}\n{top}",
        group_kind.to_uppercase()
    )
}

pub fn group_comparisons(
    previous: &GroupWrappedStats,
    current: &GroupWrappedStats,
) -> Vec<MetricComparison> {
    let mut metrics = vec![MetricComparison {
        label: "Athletes",
        previous: previous.athlete_count as f64,
        current: current.athlete_count as f64,
        percent_change: percent_change(current.athlete_count as f64, previous.athlete_count as f64),
        unit: MetricUnit::Count,
    }];
    metrics.extend(crate::commands::compare::comparisons(
        &previous.wrapped,
        &current.wrapped,
    ));
    metrics
}

pub fn render_group_comparison(
    group_kind: &str,
    group_name: &str,
    previous_year: i32,
    current_year: i32,
    previous: &GroupWrappedStats,
    current: &GroupWrappedStats,
) -> String {
    let mut table = Table::new();
    table.set_header(vec![
        "Metric".to_string(),
        previous_year.to_string(),
        current_year.to_string(),
        "% Difference".to_string(),
    ]);

    for metric in group_comparisons(previous, current) {
        table.add_row(vec![
            metric.label.to_string(),
            format_metric(metric.previous, metric.unit),
            format_metric(metric.current, metric.unit),
            metric
                .percent_change
                .map(|value| format!("{value:+.1}%"))
                .unwrap_or_else(|| "N/A".to_string()),
        ]);
    }

    format!(
        "{} — {group_name}\n{previous_year} VS {current_year} CALENDAR YEAR\n{table}",
        group_kind.to_uppercase()
    )
}

fn format_metric(value: f64, unit: MetricUnit) -> String {
    match unit {
        MetricUnit::Count => format!("{value:.0}"),
        MetricUnit::Kilograms => format!("{}kg", format_number(value)),
        MetricUnit::Percent => format!("{value:.1}%"),
    }
}

fn format_number(value: f64) -> String {
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

pub fn normalize(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn membership(name: &str, meet: &str) -> ClubMembership {
        ClubMembership {
            name: name.to_string(),
            meet: meet.to_string(),
            club: "Test Club".to_string(),
            gender: "Women".to_string(),
            weight_class: "69".to_string(),
            member_id: "1".to_string(),
            entry_total: 180.0,
        }
    }

    fn result(name: &str, meet: &str, date: &str, total: f64) -> LiftingResults {
        LiftingResults {
            federation: "USAW".to_string(),
            meet: meet.to_string(),
            date: date.to_string(),
            name: name.to_string(),
            age: "Open Women's 69kg".to_string(),
            body_weight: 68.0,
            snatch1: 70.0,
            snatch2: 75.0,
            snatch3: -78.0,
            snatch_best: 75.0,
            cj1: 90.0,
            cj2: 95.0,
            cj3: 0.0,
            cj_best: 95.0,
            total,
            adaptive: false,
        }
    }

    #[test]
    fn filters_by_both_athlete_and_represented_meet() {
        let memberships = vec![membership("Jane Doe", "Club Meet")];
        let results = vec![
            result(" jane   doe ", " club meet ", "2026-01-01", 170.0),
            result("Jane Doe", "Meet For Another Club", "2026-02-01", 175.0),
            result("Other Athlete", "Club Meet", "2026-03-01", 180.0),
        ];

        let filtered = filter_membership_results(&memberships, results);

        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].total, 170.0);
    }

    #[test]
    fn includes_split_national_results_for_the_registered_club() {
        let memberships = vec![membership(
            "Jane Doe",
            "2026 USA Weightlifting National Championships, Powered by Rogue Fitness",
        )];
        let results = vec![
            result(
                "Jane Doe",
                "The 2026 National Junior Championships, Powered by Rogue Fitness",
                "2026-06-24",
                175.0,
            ),
            result(
                "Jane Doe",
                "The 2026 National University Championships",
                "2026-04-18",
                180.0,
            ),
        ];

        let filtered = filter_membership_results(&memberships, results);

        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].total, 175.0);
    }

    #[test]
    fn year_filter_and_split_use_calendar_year_boundaries() {
        let results = vec![
            result("Jane", "Meet", "2025-12-31", 160.0),
            result("Jane", "Meet", "2026-01-01", 170.0),
            result("Jane", "Meet", "2027-01-01", 180.0),
        ];

        assert_eq!(results_for_year(results_for_test(), 2026).len(), 1);
        let (previous, current) = split_comparison_years(results, 2025, 2026);
        assert_eq!(previous.len(), 1);
        assert_eq!(current.len(), 1);
    }

    fn results_for_test() -> Vec<LiftingResults> {
        vec![
            result("Jane", "Meet", "2025-12-31", 160.0),
            result("Jane", "Meet", "2026-01-01", 170.0),
            result("Jane", "Meet", "2027-01-01", 180.0),
        ]
    }

    #[test]
    fn group_stats_deduplicate_athletes_and_preserve_wrapped_metrics() {
        let results = vec![
            result("Jane Doe", "Meet One", "2026-01-01", 170.0),
            result(" jane   doe ", "Meet Two", "2026-02-01", 175.0),
            result("John Doe", "Meet Two", "2026-02-01", 200.0),
        ];

        let stats = calculate_group_stats(&results);

        assert_eq!(stats.athlete_count, 2);
        assert_eq!(stats.wrapped.total_meets, 2);
        assert_eq!(stats.wrapped.best_total, 200.0);
    }

    #[test]
    fn group_comparison_adds_athlete_percent_difference() {
        let previous = calculate_group_stats(&[result("Jane", "Meet", "2025-01-01", 170.0)]);
        let current = calculate_group_stats(&[
            result("Jane", "Meet", "2026-01-01", 175.0),
            result("John", "Meet", "2026-01-01", 200.0),
        ]);

        let metrics = group_comparisons(&previous, &current);

        assert_eq!(metrics[0].label, "Athletes");
        assert_eq!(metrics[0].percent_change, Some(100.0));
    }

    #[test]
    fn group_wrapped_report_uses_only_meaningful_group_metrics() {
        let stats = calculate_group_stats(&[result("Jane", "Meet", "2026-01-01", 170.0)]);

        let report = render_group_wrapped("Club", "Test Club", 2026, &stats);

        assert!(report.contains("2026 CLUB WRAPPED — Test Club"));
        assert!(report.contains("Athletes"));
        assert!(report.contains("Top Meet (Best Total)"));
        assert!(!report.contains("First-to-Last"));
        assert!(!report.contains("Status"));
    }
}
