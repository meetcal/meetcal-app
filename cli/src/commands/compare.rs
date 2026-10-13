use anyhow::{Result, bail};
use clap::Parser;
use comfy_table::Table;

use crate::commands::wrapped::{
    calculate_wrapped_stats, current_year, filter_exact_name, get_athlete_year, other_names,
    refuse_cut_year,
};
use crate::types::lifting_results::LiftingResults;
use crate::types::wrapped::{SearchResponse, WrappedStats};
use crate::utils::output::{self, Report};
use crate::utils::stats::number;

/// Compare an athlete's current calendar year with the previous calendar year.
///
/// Examples:
///   meetcal compare "Maddisen Mohnsen"
#[derive(Parser)]
#[command(name = "compare")]
pub struct CompareArgs {
    /// Exact athlete name
    pub name: String,
}

#[derive(Debug, PartialEq)]
pub struct MetricComparison {
    pub label: &'static str,
    pub previous: f64,
    pub current: f64,
    pub percent_change: Option<f64>,
    pub unit: MetricUnit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MetricUnit {
    Count,
    Kilograms,
    Percent,
}

pub async fn run(args: CompareArgs) -> Result<()> {
    let current = current_year();
    let previous = current - 1;
    let (current_response, previous_response) = tokio::try_join!(
        get_athlete_year(&args.name, current),
        get_athlete_year(&args.name, previous),
    )?;
    let (previous_results, current_results) = compared_years(
        &args.name,
        (previous, previous_response),
        (current, current_response),
    )?;

    let display_name = current_results
        .first()
        .or_else(|| previous_results.first())
        .map(|row| row.name.as_str())
        .unwrap_or(&args.name);
    let current_stats = calculate_wrapped_stats(&current_results);
    let previous_stats = calculate_wrapped_stats(&previous_results);
    output::emit(comparison_report(
        display_name,
        previous,
        current,
        &previous_stats,
        &current_stats,
    ));
    Ok(())
}

/// The exact name's results for the previous and the current year, from their searches. Refuses
/// a year the search cut, since its stats would miss part of that year, and a name with no
/// results in either year.
pub fn compared_years(
    name: &str,
    (previous, previous_response): (i32, SearchResponse),
    (current, current_response): (i32, SearchResponse),
) -> Result<(Vec<LiftingResults>, Vec<LiftingResults>)> {
    let previous_results = filter_exact_name(name, previous_response.results);
    let current_results = filter_exact_name(name, current_response.results);
    refuse_cut_year(
        name,
        previous,
        previous_response.truncated,
        &previous_results,
    )?;
    refuse_cut_year(name, current, current_response.truncated, &current_results)?;

    if current_results.is_empty() && previous_results.is_empty() {
        let mut suggestions = other_names(name, current_response.suggestions);
        suggestions.extend(other_names(name, previous_response.suggestions));
        suggestions.sort();
        suggestions.dedup();
        let suffix = if suggestions.is_empty() {
            String::new()
        } else {
            let narrow = if current_response.truncated || previous_response.truncated {
                " (more athletes match; type more of the name)"
            } else {
                ""
            };
            format!(" Suggestions: {}{narrow}.", suggestions.join(", "))
        };
        bail!("No results found for \"{name}\" in {previous} or {current}.{suffix}");
    }

    Ok((previous_results, current_results))
}

pub fn comparisons(previous: &WrappedStats, current: &WrappedStats) -> Vec<MetricComparison> {
    [
        (
            "Total Weight Lifted",
            previous.total_weight_lifted,
            current.total_weight_lifted,
            MetricUnit::Kilograms,
        ),
        (
            "Meets",
            previous.total_meets as f64,
            current.total_meets as f64,
            MetricUnit::Count,
        ),
        (
            "Make Rate",
            previous.make_percentage,
            current.make_percentage,
            MetricUnit::Percent,
        ),
        (
            "Best Snatch",
            previous.best_snatch,
            current.best_snatch,
            MetricUnit::Kilograms,
        ),
        (
            "Best C&J",
            previous.best_clean_jerk,
            current.best_clean_jerk,
            MetricUnit::Kilograms,
        ),
        (
            "Best Total",
            previous.best_total,
            current.best_total,
            MetricUnit::Kilograms,
        ),
        (
            "Average Total",
            previous.average_total,
            current.average_total,
            MetricUnit::Kilograms,
        ),
    ]
    .into_iter()
    .map(|(label, previous, current, unit)| MetricComparison {
        label,
        previous,
        current,
        percent_change: percent_change(current, previous),
        unit,
    })
    .collect()
}

pub fn percent_change(current: f64, previous: f64) -> Option<f64> {
    if !current.is_finite() || !previous.is_finite() || previous == 0.0 {
        None
    } else {
        Some((current - previous) / previous * 100.0)
    }
}

pub fn render_comparison(
    name: &str,
    previous_year: i32,
    current_year: i32,
    previous: &WrappedStats,
    current: &WrappedStats,
) -> String {
    comparison_report(name, previous_year, current_year, previous, current).to_text()
}

pub fn comparison_report(
    name: &str,
    previous_year: i32,
    current_year: i32,
    previous: &WrappedStats,
    current: &WrappedStats,
) -> Report {
    let rows = comparisons(previous, current)
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
            "{name} — {previous_year} VS {current_year} CALENDAR YEAR"
        ))
}

/// A year-over-year comparison of `rows` (metric, previous, current, % difference): shown with
/// the years as column headers, exported with fixed keys and the years as values, so a script
/// reads `.previous` whatever the years.
pub fn comparison_tables(
    previous_year: i32,
    current_year: i32,
    rows: Vec<[String; 4]>,
) -> (Table, Table) {
    let mut table = Table::new();
    table.set_header(vec![
        "Metric".to_string(),
        previous_year.to_string(),
        current_year.to_string(),
        "% Difference".to_string(),
    ]);
    let mut data = Table::new();
    data.set_header(vec![
        "Metric",
        "Previous Year",
        "Previous",
        "Current Year",
        "Current",
        "% Difference",
    ]);
    for [label, previous, current, difference] in rows {
        table.add_row(vec![
            label.clone(),
            previous.clone(),
            current.clone(),
            difference.clone(),
        ]);
        data.add_row(vec![
            label,
            previous_year.to_string(),
            previous,
            current_year.to_string(),
            current,
            difference,
        ]);
    }
    (table, data)
}

/// A metric's value as the comparison tables show it.
pub fn format_metric(value: f64, unit: MetricUnit) -> String {
    match unit {
        MetricUnit::Count => format!("{value:.0}"),
        MetricUnit::Kilograms => format!("{}kg", number(value)),
        MetricUnit::Percent => format!("{value:.1}%"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stats(volume: f64, meets: usize, rate: f64, total: f64) -> WrappedStats {
        WrappedStats {
            total_weight_lifted: volume,
            total_meets: meets,
            make_percentage: rate,
            best_snatch: total * 0.45,
            best_clean_jerk: total * 0.55,
            best_total: total,
            average_total: total - 10.0,
            top_meet: None,
            improvement_from_first: None,
            consecutive_makes: 0,
            favorite_attempt: None,
            year_rank: "Rising Star",
        }
    }

    fn row(name: &str, date: &str) -> LiftingResults {
        LiftingResults {
            federation: "USAW".to_string(),
            meet: "Meet".to_string(),
            date: date.to_string(),
            name: name.to_string(),
            age: "Open Women's 69kg".to_string(),
            body_weight: 68.5,
            snatch1: 70.0,
            snatch2: 72.0,
            snatch3: 74.0,
            snatch_best: 74.0,
            cj1: 90.0,
            cj2: 92.0,
            cj3: 94.0,
            cj_best: 94.0,
            total: 168.0,
            adaptive: false,
        }
    }

    fn response(results: Vec<LiftingResults>, truncated: bool) -> SearchResponse {
        SearchResponse {
            matched_name: None,
            suggestions: Vec::new(),
            results,
            truncated,
        }
    }

    #[test]
    fn exports_fixed_keys_with_the_years_as_values() {
        let report = comparison_report(
            "Jane Doe",
            2025,
            2026,
            &stats(1000.0, 2, 80.0, 200.0),
            &stats(1500.0, 3, 75.0, 210.0),
        );
        let json = report.to_json();
        let total = json
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["metric"] == "Best Total")
            .expect("a best total row");
        assert_eq!(total["previous_year"], 2025);
        assert_eq!(total["previous"], 200);
        assert_eq!(total["current_year"], 2026);
        assert_eq!(total["current"], 210);
        assert_eq!(total["difference"], 5);
        assert!(report.to_text().contains("2025"));
    }

    #[test]
    fn compares_two_complete_years() {
        let (previous, current) = compared_years(
            "Jane Doe",
            (2025, response(vec![row("Jane Doe", "2025-03-01")], false)),
            (2026, response(vec![row("Jane Doe", "2026-03-01")], false)),
        )
        .unwrap();

        assert_eq!(previous.len(), 1);
        assert_eq!(current.len(), 1);
    }

    #[test]
    fn refuses_a_cut_current_year() {
        let error = compared_years(
            "Jane Doe",
            (2025, response(vec![row("Jane Doe", "2025-03-01")], false)),
            (2026, response(vec![row("Jane Doe", "2026-03-01")], true)),
        )
        .unwrap_err()
        .to_string();

        assert!(error.contains("more results in 2026"));
        assert!(error.contains("meetcal progress \"Jane Doe\" --since 2026"));
    }

    #[test]
    fn refuses_a_cut_previous_year() {
        let error = compared_years(
            "Jane Doe",
            (2025, response(vec![row("Jane Doe", "2025-03-01")], true)),
            (2026, response(vec![row("Jane Doe", "2026-03-01")], false)),
        )
        .unwrap_err()
        .to_string();

        assert!(error.contains("more results in 2025"));
    }

    #[test]
    fn a_cut_search_of_other_names_does_not_block_a_year_without_results() {
        // No exact result that year, so the search fell back to similar names and cut those.
        let (previous, current) = compared_years(
            "Jane Doe",
            (2025, response(vec![row("Jane Doer", "2025-03-01")], true)),
            (2026, response(vec![row("Jane Doe", "2026-03-01")], false)),
        )
        .unwrap();

        assert!(previous.is_empty());
        assert_eq!(current.len(), 1);
    }

    #[test]
    fn no_results_in_a_cut_search_asks_for_more_of_the_name() {
        let mut cut = response(Vec::new(), true);
        cut.suggestions = vec!["Jane Doe".to_string()];

        let error = compared_years("Doe", (2025, response(Vec::new(), false)), (2026, cut))
            .unwrap_err()
            .to_string();

        assert!(error.contains("No results found for \"Doe\" in 2025 or 2026"));
        assert!(
            error.contains("Suggestions: Jane Doe (more athletes match; type more of the name)")
        );
    }

    #[test]
    fn calculates_positive_negative_and_unchanged_percent_changes() {
        assert_eq!(percent_change(120.0, 100.0), Some(20.0));
        assert_eq!(percent_change(80.0, 100.0), Some(-20.0));
        assert_eq!(percent_change(100.0, 100.0), Some(0.0));
    }

    #[test]
    fn zero_or_invalid_baseline_has_no_percent_change() {
        assert_eq!(percent_change(100.0, 0.0), None);
        assert_eq!(percent_change(f64::NAN, 100.0), None);
        assert_eq!(percent_change(100.0, f64::INFINITY), None);
    }

    #[test]
    fn comparisons_include_every_requested_year_metric() {
        let metrics = comparisons(
            &stats(1_000.0, 2, 50.0, 200.0),
            &stats(1_500.0, 3, 75.0, 220.0),
        );
        let labels: Vec<_> = metrics.iter().map(|metric| metric.label).collect();

        assert_eq!(
            labels,
            vec![
                "Total Weight Lifted",
                "Meets",
                "Make Rate",
                "Best Snatch",
                "Best C&J",
                "Best Total",
                "Average Total",
            ]
        );
        assert_eq!(metrics[0].percent_change, Some(50.0));
    }

    #[test]
    fn report_formats_percent_differences_and_zero_baselines() {
        let previous = stats(0.0, 0, 0.0, 0.0);
        let current = stats(1_000.0, 2, 75.0, 200.0);

        let report = render_comparison("Jane Doe", 2025, 2026, &previous, &current);

        assert!(report.contains("Jane Doe — 2025 VS 2026 CALENDAR YEAR"));
        assert!(report.contains("% Difference"));
        assert!(report.contains("N/A"));
        assert!(report.contains("1000kg"));
    }
}
