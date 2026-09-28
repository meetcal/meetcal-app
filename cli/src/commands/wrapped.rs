use std::collections::{HashMap, HashSet};

use anyhow::{Result, bail};
use chrono::{Datelike, Utc};
use clap::Parser;
use comfy_table::Table;

use crate::types::lifting_results::LiftingResults;
use crate::types::wrapped::{SearchResponse, WrappedStats};
use crate::utils::backend::get_json;

/// Show an athlete's calendar year in lifting.
///
/// Examples:
///   meetcal wrapped "Maddisen Mohnsen"
///   meetcal wrapped "Maddisen Mohnsen" --year 2025
#[derive(Parser)]
#[command(name = "wrapped")]
pub struct WrappedArgs {
    /// Exact athlete name
    pub name: String,

    /// Calendar year to summarize (defaults to the current year)
    #[arg(long, short = 'y', value_parser = clap::value_parser!(i32).range(1900..=9999))]
    pub year: Option<i32>,
}

pub async fn run(args: WrappedArgs) -> Result<()> {
    let year = args.year.unwrap_or_else(current_year);
    let response = get_athlete_year(&args.name, year).await?;
    let results = exact_name_results(&args.name, response)?;

    if results.is_empty() {
        bail!("No results found for \"{}\" in {year}", args.name);
    }

    let display_name = results[0].name.clone();
    let stats = calculate_wrapped_stats(&results);
    println!("{}", render_wrapped_report(&display_name, year, &stats));
    Ok(())
}

pub fn current_year() -> i32 {
    Utc::now().year()
}

pub async fn get_athlete_year(name: &str, year: i32) -> Result<SearchResponse> {
    let start_date = format!("{year:04}-01-01");
    let end_date = format!("{:04}-01-01", year + 1);
    let query = [
        ("query", name.to_string()),
        ("start_date", start_date),
        ("end_date", end_date),
    ];

    get_json("/search", &query).await
}

pub fn exact_name_results(name: &str, response: SearchResponse) -> Result<Vec<LiftingResults>> {
    let results = filter_exact_name(name, response.results);

    if results.is_empty() && !response.suggestions.is_empty() {
        bail!(
            "No exact results found for \"{name}\". Suggestions: {}",
            response.suggestions.join(", ")
        );
    }

    Ok(results)
}

pub fn filter_exact_name(name: &str, results: Vec<LiftingResults>) -> Vec<LiftingResults> {
    let normalized_name = normalize(name);
    results
        .into_iter()
        .filter(|row| normalize(&row.name) == normalized_name)
        .collect()
}

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

        best_snatch = best_snatch.max(positive(result.snatch_best));
        best_clean_jerk = best_clean_jerk.max(positive(result.cj_best));
        best_total = best_total.max(positive(result.total));

        if result.total > 0.0 && result.total.is_finite() {
            positive_totals.push(result.total);
            meet_best_totals
                .entry(result.meet.clone())
                .and_modify(|best| *best = best.max(result.total))
                .or_insert(result.total);
        }
    }

    let total_meets = ordered
        .iter()
        .map(|result| normalize(&result.meet))
        .collect::<HashSet<_>>()
        .len();
    let make_percentage = percentage(successful_attempts, recorded_attempts);
    let average_total = if positive_totals.is_empty() {
        0.0
    } else {
        positive_totals.iter().sum::<f64>() / positive_totals.len() as f64
    };
    let improvement_from_first = match (positive_totals.first(), positive_totals.last()) {
        (Some(first), Some(last)) => last - first,
        _ => 0.0,
    };
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
        consecutive_makes: max_consecutive_makes,
        favorite_attempt,
        year_rank,
    }
}

pub fn render_wrapped_report(name: &str, year: i32, stats: &WrappedStats) -> String {
    let mut headline = Table::new();
    headline.set_header(vec!["Meets", "Make Rate", "Best Total", "Status"]);
    headline.add_row(vec![
        stats.total_meets.to_string(),
        format!("{:.1}%", stats.make_percentage),
        format!("{}kg", format_weight(stats.best_total)),
        stats.year_rank.to_string(),
    ]);

    let mut volume = Table::new();
    volume.set_header(vec![
        "Total Weight Lifted",
        "Best Snatch",
        "Best C&J",
        "Average Total",
    ]);
    volume.add_row(vec![
        format!("{}kg", format_weight(stats.total_weight_lifted)),
        format!("{}kg", format_weight(stats.best_snatch)),
        format!("{}kg", format_weight(stats.best_clean_jerk)),
        format!("{}kg", format_weight(stats.average_total)),
    ]);

    let mut journey = Table::new();
    journey.set_header(vec![
        "Top Meet",
        "First-to-Last Total",
        "Longest Make Streak",
        "Favorite Attempt",
    ]);
    journey.add_row(vec![
        stats.top_meet.clone().unwrap_or_else(|| "N/A".to_string()),
        format!("{:+}kg", format_weight(stats.improvement_from_first)),
        stats.consecutive_makes.to_string(),
        stats
            .favorite_attempt
            .map(ordinal)
            .unwrap_or_else(|| "N/A".to_string()),
    ]);

    format!("{year} WEIGHTLIFTING WRAPPED — {name}\n{headline}\n{volume}\n{journey}")
}

fn percentage(successes: usize, attempts: usize) -> f64 {
    if attempts == 0 {
        0.0
    } else {
        successes as f64 / attempts as f64 * 100.0
    }
}

fn positive(value: f64) -> f64 {
    if value > 0.0 && value.is_finite() {
        value
    } else {
        0.0
    }
}

fn ordinal(attempt: usize) -> String {
    match attempt {
        1 => "1st".to_string(),
        2 => "2nd".to_string(),
        3 => "3rd".to_string(),
        _ => attempt.to_string(),
    }
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

fn normalize(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

#[cfg(test)]
mod tests {
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
        assert_eq!(stats.improvement_from_first, 10.0);
        assert_eq!(stats.consecutive_makes, 6);
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

        assert_eq!(stats.improvement_from_first, 22.0);
        assert_eq!(stats.consecutive_makes, 10);
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
        assert_eq!(stats.improvement_from_first, 0.0);
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

    #[test]
    fn exact_name_filter_rejects_partial_matches_with_suggestions() {
        let response = SearchResponse {
            matched_name: None,
            suggestions: vec!["Jane Doe".to_string()],
            results: vec![result("2026-01-01", "Meet", [70.0; 6], 70.0, 90.0, 160.0)],
        };

        let error = exact_name_results("Janet Doe", response)
            .unwrap_err()
            .to_string();

        assert!(error.contains("Suggestions: Jane Doe"));
    }

    #[test]
    fn renders_every_app_metric() {
        let stats =
            calculate_wrapped_stats(&[result("2026-01-01", "Meet", [70.0; 6], 70.0, 90.0, 160.0)]);

        let report = render_wrapped_report("Jane Doe", 2026, &stats);

        for text in [
            "2026 WEIGHTLIFTING WRAPPED — Jane Doe",
            "Total Weight Lifted",
            "Best Snatch",
            "Best C&J",
            "Average Total",
            "Top Meet",
            "First-to-Last Total",
            "Longest Make Streak",
            "Favorite Attempt",
        ] {
            assert!(report.contains(text), "report omitted {text}");
        }
    }
}
