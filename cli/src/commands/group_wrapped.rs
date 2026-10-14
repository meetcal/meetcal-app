use std::collections::{HashMap, HashSet};

use anyhow::Result;
use chrono::NaiveDate;
use comfy_table::Table;
use serde::Deserialize;

use crate::commands::compare::{
    MetricComparison, MetricUnit, comparison_tables, format_metric, percent_change,
};
use crate::types::lifting_results::LiftingResults;
use crate::types::wrapped::WrappedStats;
use crate::utils::backend::{queries, query, query_all_pages};
use crate::utils::meet_names::equivalent_meets;
use crate::utils::output::Report;
use crate::utils::stats::{Lift, fold, number, valid_lift, valid_total};
use serde_json::json;

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

/// Every registration of the club's athletes. Read in pages, so rows are in no particular order
/// and may repeat; the reports dedupe names and match meets, so neither matters.
pub async fn get_club_memberships(club: &str) -> Result<Vec<ClubMembership>> {
    query_all_pages(queries::CLUB_ATHLETES, &json!({ "club": club })).await
}

/// Every registration of the WSO's athletes; read in pages like [`get_club_memberships`].
pub async fn get_wso_memberships(wso: &str) -> Result<Vec<ClubMembership>> {
    query_all_pages(queries::WSO_ATHLETES, &json!({ "wso": wso })).await
}

pub async fn get_recent_results(
    names: &[String],
    cutoff_date: &str,
) -> Result<Vec<LiftingResults>> {
    let mut results = Vec::new();
    for batch in names.chunks(RESULTS_REQUEST_BATCH_SIZE) {
        let args = json!({ "names": batch, "cutoffDate": cutoff_date });
        let mut rows: Vec<LiftingResults> = query(queries::RECENT_RESULTS, &args).await?;
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
    let names = distinct_names(&memberships);
    let results = get_recent_results(&names, cutoff_date).await?;
    let filtered = filter_membership_results(&memberships, results);
    Ok((memberships, filtered))
}

/// Each member's name once (the first spelling), in registration order; names that differ only
/// in case or spacing are one athlete.
pub fn distinct_names(memberships: &[ClubMembership]) -> Vec<String> {
    let mut seen = HashSet::new();
    memberships
        .iter()
        .filter(|membership| seen.insert(fold(&membership.name)))
        .map(|membership| membership.name.clone())
        .collect()
}

pub fn filter_membership_results(
    memberships: &[ClubMembership],
    results: Vec<LiftingResults>,
) -> Vec<LiftingResults> {
    // Each athlete's registered meets, built once: a lookup per result instead of a scan of
    // every registration (a large WSO has tens of thousands of both).
    let mut meets_by_athlete: HashMap<String, HashSet<&str>> = HashMap::new();
    for membership in memberships {
        meets_by_athlete
            .entry(fold(&membership.name))
            .or_default()
            .insert(membership.meet.as_str());
    }

    results
        .into_iter()
        .filter(|result| {
            meets_by_athlete
                .get(&fold(&result.name))
                .is_some_and(|meets| {
                    meets
                        .iter()
                        .any(|meet| equivalent_meets(meet, &result.meet))
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
        .map(|result| fold(&result.name))
        .collect::<HashSet<_>>()
        .len();

    GroupWrappedStats {
        athlete_count,
        wrapped: calculate_wrapped_stats(results),
    }
}

/// A year's Wrapped numbers scored from `results` (any athletes', in any order): club and WSO
/// reports read the group's rows and score them here. An athlete's own Wrapped is the server's
/// (`results:wrapped`).
pub fn calculate_wrapped_stats(results: &[LiftingResults]) -> WrappedStats {
    let mut ordered: Vec<_> = results.iter().collect();
    ordered.sort_by(|left, right| {
        left.date
            .cmp(&right.date)
            .then_with(|| left.meet.cmp(&right.meet))
            .then_with(|| left.name.cmp(&right.name))
    });

    let mut total_weight_lifted = 0.0;
    let mut recorded_attempts = 0;
    let mut successful_attempts = 0;
    let mut consecutive_makes = 0;
    let mut max_consecutive_makes = 0;
    let mut attempt_makes = [0_usize; 3];
    let mut meet_best_totals: HashMap<String, f64> = HashMap::new();
    let mut positive_totals = Vec::new();
    let mut best_snatch: f64 = 0.0;
    let mut best_clean_jerk: f64 = 0.0;
    let mut best_total: f64 = 0.0;

    for result in &ordered {
        for (index, attempt) in [
            result.snatch1,
            result.snatch2,
            result.snatch3,
            result.cj1,
            result.cj2,
            result.cj3,
        ]
        .into_iter()
        .enumerate()
        {
            if attempt == 0.0 || !attempt.is_finite() {
                continue;
            }

            recorded_attempts += 1;
            if attempt > 0.0 {
                successful_attempts += 1;
                total_weight_lifted += attempt;
                consecutive_makes += 1;
                max_consecutive_makes = max_consecutive_makes.max(consecutive_makes);
                attempt_makes[index % 3] += 1;
            } else {
                consecutive_makes = 0;
            }
        }

        // Bests, averages and the top meet leave out source errors (`stats::plausible`).
        best_snatch = best_snatch.max(valid_lift(result, Lift::Snatch).unwrap_or(0.0));
        best_clean_jerk =
            best_clean_jerk.max(valid_lift(result, Lift::CleanAndJerk).unwrap_or(0.0));

        if let Some(total) = valid_total(result).filter(|total| total.is_finite()) {
            best_total = best_total.max(total);
            positive_totals.push(total);
            meet_best_totals
                .entry(result.meet.clone())
                .and_modify(|best| *best = best.max(total))
                .or_insert(total);
        }
    }

    let total_meets = ordered
        .iter()
        .map(|result| fold(&result.meet))
        .collect::<HashSet<_>>()
        .len();
    let make_percentage = percentage(successful_attempts, recorded_attempts);
    let average_total = if positive_totals.is_empty() {
        0.0
    } else {
        positive_totals.iter().sum::<f64>() / positive_totals.len() as f64
    };
    let improvement_from_first = first_to_last_meet(&ordered);
    let top_meet = meet_best_totals
        .into_iter()
        .max_by(|(left_name, left_total), (right_name, right_total)| {
            left_total
                .total_cmp(right_total)
                .then_with(|| right_name.cmp(left_name))
        })
        .map(|(meet, _)| meet);
    let favorite_attempt = attempt_makes
        .iter()
        .enumerate()
        .filter(|(_, count)| **count > 0)
        .max_by(|(left_index, left), (right_index, right)| {
            left.cmp(right).then_with(|| right_index.cmp(left_index))
        })
        .map(|(index, _)| index + 1);
    let year_rank = if make_percentage >= 90.0 {
        "Consistency King"
    } else if best_total >= 300.0 {
        "Heavy Hitter"
    } else if total_meets >= 5 {
        "Meet Regular"
    } else {
        "Rising Star"
    };

    WrappedStats {
        total_weight_lifted,
        total_meets,
        make_percentage,
        best_snatch,
        best_clean_jerk,
        best_total,
        average_total,
        top_meet,
        improvement_from_first,
        longest_make_streak: max_consecutive_makes,
        favorite_attempt,
        year_rank: year_rank.to_string(),
    }
}
/// Rows of one meet name dated at most this many days after its first row are one meet (a
/// national championships runs about ten days); later ones are another edition of a name used
/// more than once a year.
const MEET_SPAN_DAYS: i64 = 14;

/// The change from the year's first meet with a total to its last, one total per meet (its
/// best); `None` with fewer than two such meets. The app's rule (#123): two rows from one meet,
/// the same lifts listed in two divisions, are not progress. A meet is its name and its dates
/// ([`MEET_SPAN_DAYS`]), so two editions of one name in a year are two meets. `ordered` is
/// oldest first.
fn first_to_last_meet(ordered: &[&LiftingResults]) -> Option<f64> {
    // (name, first date, best total)
    let mut meets: Vec<(String, &str, f64)> = Vec::new();
    for row in ordered {
        let Some(total) = valid_total(row) else {
            continue;
        };
        let meet = fold(&row.meet);
        let edition = meets
            .iter_mut()
            .rev()
            .find(|(name, start, _)| *name == meet && same_meet_dates(start, &row.date));
        match edition {
            Some((_, _, best)) => *best = best.max(total),
            None => meets.push((meet, row.date.as_str(), total)),
        }
    }
    match (meets.first(), meets.last()) {
        (Some(first), Some(last)) if meets.len() >= 2 => Some(last.2 - first.2),
        _ => None,
    }
}

/// Whether `date` is within [`MEET_SPAN_DAYS`] of `start` (`YYYY-MM-DD`); unreadable dates are.
fn same_meet_dates(start: &str, date: &str) -> bool {
    let parse = |value: &str| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok();
    match (parse(start), parse(date)) {
        (Some(start), Some(date)) => (date - start).num_days().abs() <= MEET_SPAN_DAYS,
        _ => true,
    }
}

fn percentage(successes: usize, attempts: usize) -> f64 {
    if attempts == 0 {
        0.0
    } else {
        successes as f64 / attempts as f64 * 100.0
    }
}

pub fn render_group_wrapped(
    group_kind: &str,
    group_name: &str,
    year: i32,
    stats: &GroupWrappedStats,
) -> String {
    group_wrapped_report(group_kind, group_name, year, stats).to_text()
}

pub fn group_wrapped_report(
    group_kind: &str,
    group_name: &str,
    year: i32,
    stats: &GroupWrappedStats,
) -> Report {
    let mut overview = Table::new();
    overview.set_header(vec!["Athletes", "Meets", "Make Rate", "Average Total"]);
    overview.add_row(vec![
        stats.athlete_count.to_string(),
        stats.wrapped.total_meets.to_string(),
        format!("{:.1}%", stats.wrapped.make_percentage),
        format!("{}kg", number(stats.wrapped.average_total)),
    ]);

    let mut lifts = Table::new();
    lifts.set_header(vec![
        "Total Weight Lifted",
        "Best Snatch",
        "Best C&J",
        "Best Total",
    ]);
    lifts.add_row(vec![
        format!("{}kg", number(stats.wrapped.total_weight_lifted)),
        format!("{}kg", number(stats.wrapped.best_snatch)),
        format!("{}kg", number(stats.wrapped.best_clean_jerk)),
        format!("{}kg", number(stats.wrapped.best_total)),
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

    Report::new()
        .titled(format!(
            "{year} {} WRAPPED — {group_name}",
            group_kind.to_uppercase()
        ))
        .table("overview", overview)
        .table("lifts", lifts)
        .table("top_meet", top)
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
    group_comparison_report(
        group_kind,
        group_name,
        previous_year,
        current_year,
        previous,
        current,
    )
    .to_text()
}

pub fn group_comparison_report(
    group_kind: &str,
    group_name: &str,
    previous_year: i32,
    current_year: i32,
    previous: &GroupWrappedStats,
    current: &GroupWrappedStats,
) -> Report {
    let rows = group_comparisons(previous, current)
        .into_iter()
        .map(|metric| {
            [
                metric.label.to_string(),
                format_metric(metric.previous, metric.unit),
                format_metric(metric.current, metric.unit),
                metric
                    .percent_change
                    .map(|value| format!("{value:+.1}%"))
                    .unwrap_or_else(|| "N/A".to_string()),
            ]
        })
        .collect();
    let (table, data) = comparison_tables(previous_year, current_year, rows);
    Report::new()
        .table_with_data("comparison", table, data)
        .titled(format!(
            "{} — {group_name}\n{previous_year} VS {current_year} CALENDAR YEAR",
            group_kind.to_uppercase()
        ))
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

    #[test]
    fn distinct_names_keep_the_first_spelling_of_each_athlete() {
        let memberships = vec![
            membership("Jane Doe", "A"),
            membership("jane  doe", "B"),
            membership("John Roe", "A"),
            membership(" Jane Doe ", "C"),
        ];
        assert_eq!(distinct_names(&memberships), ["Jane Doe", "John Roe"]);
    }

    /// A result whose total is its snatch (75) plus clean & jerk.
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
            cj2: total - 75.0,
            cj3: 0.0,
            cj_best: total - 75.0,
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
    fn matches_each_meet_an_athlete_registered_at() {
        let memberships = vec![
            membership("Jane Doe", "Meet One"),
            membership("Other Athlete", "Meet Three"),
            membership(" jane  DOE", "Meet Two"),
        ];
        let results = vec![
            result("Jane Doe", "Meet One", "2026-01-01", 170.0),
            result("Jane Doe", "Meet Two", "2026-02-01", 175.0),
            result("Jane Doe", "Meet Three", "2026-03-01", 180.0),
            result("Other Athlete", "Meet Three", "2026-03-01", 185.0),
        ];

        let filtered = filter_membership_results(&memberships, results);

        let totals: Vec<_> = filtered.iter().map(|result| result.total).collect();
        assert_eq!(totals, vec![170.0, 175.0, 185.0]);
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

#[cfg(test)]
mod scoring_tests {
    use super::*;

    fn result(
        date: &str,
        meet: &str,
        attempts: [f64; 6],
        snatch_best: f64,
        cj_best: f64,
        total: f64,
    ) -> LiftingResults {
        LiftingResults {
            federation: "USAW".to_string(),
            meet: meet.to_string(),
            date: date.to_string(),
            name: "Jane Doe".to_string(),
            age: "Open Women's 69kg".to_string(),
            body_weight: 68.5,
            snatch1: attempts[0],
            snatch2: attempts[1],
            snatch3: attempts[2],
            snatch_best,
            cj1: attempts[3],
            cj2: attempts[4],
            cj3: attempts[5],
            cj_best,
            total,
            adaptive: false,
        }
    }

    #[test]
    fn calculates_app_wrapped_metrics_from_recorded_attempts() {
        let results = vec![
            result(
                "2026-01-01",
                "First Meet",
                [70.0, -75.0, 75.0, 90.0, 95.0, 0.0],
                75.0,
                95.0,
                170.0,
            ),
            result(
                "2026-05-01",
                "Best Meet",
                [75.0, 78.0, 80.0, -98.0, 98.0, 100.0],
                80.0,
                100.0,
                180.0,
            ),
        ];

        let stats = calculate_wrapped_stats(&results);

        assert_eq!(stats.total_weight_lifted, 761.0);
        assert_eq!(stats.total_meets, 2);
        assert!((stats.make_percentage - (9.0 / 11.0 * 100.0)).abs() < 0.000_001);
        assert_eq!(stats.best_snatch, 80.0);
        assert_eq!(stats.best_clean_jerk, 100.0);
        assert_eq!(stats.best_total, 180.0);
        assert_eq!(stats.average_total, 175.0);
        assert_eq!(stats.top_meet.as_deref(), Some("Best Meet"));
        assert_eq!(stats.improvement_from_first, Some(10.0));
        assert_eq!(stats.longest_make_streak, 6);
        assert_eq!(stats.favorite_attempt, Some(1));
        assert_eq!(stats.year_rank, "Rising Star");
    }

    #[test]
    fn sorts_results_before_first_to_last_improvement_and_streaks() {
        let results = vec![
            result(
                "2026-12-01",
                "Last",
                [80.0, 82.0, 84.0, 100.0, 102.0, 104.0],
                84.0,
                104.0,
                188.0,
            ),
            result(
                "2026-01-01",
                "First",
                [70.0, -72.0, 72.0, 90.0, 92.0, 94.0],
                72.0,
                94.0,
                166.0,
            ),
        ];

        let stats = calculate_wrapped_stats(&results);

        assert_eq!(stats.improvement_from_first, Some(22.0));
        assert_eq!(stats.longest_make_streak, 10);
    }

    #[test]
    fn ignores_zero_and_non_finite_attempts() {
        let results = vec![result(
            "2026-01-01",
            "Meet",
            [0.0, f64::NAN, f64::INFINITY, -70.0, 70.0, 0.0],
            f64::NAN,
            70.0,
            0.0,
        )];

        let stats = calculate_wrapped_stats(&results);

        assert_eq!(stats.total_weight_lifted, 70.0);
        assert_eq!(stats.make_percentage, 50.0);
        assert_eq!(stats.best_snatch, 0.0);
        assert_eq!(stats.average_total, 0.0);
        assert_eq!(stats.improvement_from_first, None);
    }

    #[test]
    fn one_meet_has_no_first_to_last_change() {
        let one = vec![result(
            "2026-03-01",
            "Only Meet",
            [70.0, 75.0, 0.0, 90.0, 95.0, 0.0],
            75.0,
            95.0,
            170.0,
        )];
        let stats = calculate_wrapped_stats(&one);
        assert_eq!(stats.improvement_from_first, None);

        // The same lifts listed in two divisions at one meet are not progress.
        let mut masters = one[0].clone();
        masters.age = "Women's Masters (35-39) 69kg".into();
        masters.total = 175.0;
        masters.cj_best = 100.0;
        masters.cj2 = 100.0;
        let stats = calculate_wrapped_stats(&[one[0].clone(), masters]);
        assert_eq!(stats.improvement_from_first, None);
    }

    #[test]
    fn two_editions_of_one_meet_name_in_a_year_are_two_meets() {
        let lift = |date: &str, total: f64| {
            result(
                date,
                "Open",
                [70.0, 0.0, 0.0, total - 70.0, 0.0, 0.0],
                70.0,
                total - 70.0,
                total,
            )
        };
        let stats =
            calculate_wrapped_stats(&[lift("2026-01-10", 160.0), lift("2026-12-05", 175.0)]);
        assert_eq!(stats.improvement_from_first, Some(15.0));

        // With a meet between them, the last edition is still the last meet.
        let middle = result(
            "2026-06-01",
            "Summer",
            [70.0, 0.0, 0.0, 95.0, 0.0, 0.0],
            70.0,
            95.0,
            165.0,
        );
        let stats = calculate_wrapped_stats(&[
            lift("2026-01-10", 160.0),
            middle,
            lift("2026-12-05", 175.0),
        ]);
        assert_eq!(stats.improvement_from_first, Some(15.0));

        // Days of one meet (divisions on different days) stay one meet.
        let stats =
            calculate_wrapped_stats(&[lift("2026-06-20", 160.0), lift("2026-06-27", 170.0)]);
        assert_eq!(stats.improvement_from_first, None);
    }

    #[test]
    fn assigns_status_in_priority_order() {
        let consistent = vec![result(
            "2026-01-01",
            "Meet",
            [100.0; 6],
            100.0,
            210.0,
            310.0,
        )];
        assert_eq!(
            calculate_wrapped_stats(&consistent).year_rank,
            "Consistency King"
        );

        let heavy = vec![result(
            "2026-01-01",
            "Meet",
            [100.0, -101.0, 102.0, 200.0, -201.0, 202.0],
            102.0,
            202.0,
            304.0,
        )];
        assert_eq!(calculate_wrapped_stats(&heavy).year_rank, "Heavy Hitter");
    }
}
