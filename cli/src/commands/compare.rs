use anyhow::{Result, bail};
use clap::Parser;
use comfy_table::Table;

use crate::commands::wrapped::{current_year, get_wrapped, other_names, unscored};
use crate::types::wrapped::{WrappedAnswer, WrappedStats};
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

/// Both years of an athlete's comparison: the name to show and each year's stats (zeros for a
/// year without results).
#[derive(Debug, PartialEq)]
pub struct ComparedYears {
    pub name: String,
    pub previous: WrappedStats,
    pub current: WrappedStats,
}

pub async fn run(args: CompareArgs) -> Result<()> {
    let current = current_year();
    let previous = current - 1;
    let (current_answer, previous_answer) = tokio::try_join!(
        get_wrapped(&args.name, current),
        get_wrapped(&args.name, previous),
    )?;
    let years = compared_years(
        &args.name,
        (previous, previous_answer),
        (current, current_answer),
    )?;

    output::emit(comparison_report(
        &years.name,
        previous,
        current,
        &years.previous,
        &years.current,
    ));
    Ok(())
}

/// The previous and current years' Wrapped answers (`results:wrapped`), as the stats to compare.
/// Refuses a year with more results than the server scores, since its stats would miss part of
/// that year, and a name with no results in either year (with the server's suggestions).
pub fn compared_years(
    name: &str,
    (previous, previous_answer): (i32, WrappedAnswer),
    (current, current_answer): (i32, WrappedAnswer),
) -> Result<ComparedYears> {
    let mut suggestions = Vec::new();
    let mut read = |year: i32, answer: WrappedAnswer| -> Result<Option<(String, WrappedStats)>> {
        match answer {
            WrappedAnswer::Athlete { name, stats } => Ok(Some((name, stats))),
            WrappedAnswer::NoResults { suggestions: names } => {
                suggestions.extend(other_names(name, names));
                Ok(None)
            }
            other => Err(unscored(name, year, other)),
        }
    };
    let previous_year = read(previous, previous_answer)?;
    let current_year = read(current, current_answer)?;

    let display_name = match (&current_year, &previous_year) {
        (Some((athlete, _)), _) | (None, Some((athlete, _))) => athlete.clone(),
        (None, None) => {
            suggestions.sort();
            suggestions.dedup();
            let suffix = if suggestions.is_empty() {
                String::new()
            } else {
                format!(" Suggestions: {}.", suggestions.join(", "))
            };
            bail!("No results found for \"{name}\" in {previous} or {current}.{suffix}");
        }
    };
    let stats =
        |year: Option<(String, WrappedStats)>| year.map(|(_, stats)| stats).unwrap_or_default();
    Ok(ComparedYears {
        name: display_name,
        previous: stats(previous_year),
        current: stats(current_year),
    })
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
            longest_make_streak: 0,
            favorite_attempt: None,
            year_rank: "Rising Star".to_string(),
        }
    }

    fn athlete(name: &str, total: f64) -> WrappedAnswer {
        WrappedAnswer::Athlete {
            name: name.to_string(),
            stats: stats(1000.0, 2, 80.0, total),
        }
    }

    fn none(suggestions: &[&str]) -> WrappedAnswer {
        WrappedAnswer::NoResults {
            suggestions: suggestions.iter().map(|name| name.to_string()).collect(),
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
    fn compares_two_scored_years_under_the_athletes_spelling() {
        let years = compared_years(
            "jane  doe",
            (2025, athlete("Jane Doe", 200.0)),
            (2026, athlete("Jane Doe", 210.0)),
        )
        .unwrap();

        assert_eq!(years.name, "Jane Doe");
        assert_eq!(years.previous.best_total, 200.0);
        assert_eq!(years.current.best_total, 210.0);
    }

    #[test]
    fn a_year_without_results_compares_as_zeros() {
        let years = compared_years(
            "Jane Doe",
            (2025, athlete("Jane Doe", 200.0)),
            (2026, none(&["Jane Doe"])),
        )
        .unwrap();

        assert_eq!(years.name, "Jane Doe");
        assert_eq!(years.current, WrappedStats::default());
        let report = render_comparison("Jane Doe", 2025, 2026, &years.previous, &years.current);
        assert!(report.contains("-100.0%"));
    }

    #[test]
    fn refuses_a_year_with_too_many_results() {
        for (previous, current, year) in [
            (
                athlete("Jane Doe", 200.0),
                WrappedAnswer::TooManyResults {
                    name: "Jane Doe".into(),
                },
                2026,
            ),
            (
                WrappedAnswer::TooManyResults {
                    name: "Jane Doe".into(),
                },
                athlete("Jane Doe", 200.0),
                2025,
            ),
        ] {
            let error = compared_years("Jane Doe", (2025, previous), (2026, current))
                .unwrap_err()
                .to_string();
            assert!(
                error.contains(&format!("more results in {year}")),
                "{error}"
            );
            assert!(error.contains(&format!("meetcal progress \"Jane Doe\" --since {year}")));
        }
    }

    #[test]
    fn no_results_in_either_year_lists_the_other_names() {
        let error = compared_years(
            "Jane Do",
            (2025, none(&["Jane Doe", "Jane Do"])),
            (2026, none(&["Jane Doe", "Jane Dorn"])),
        )
        .unwrap_err()
        .to_string();

        assert_eq!(
            error,
            "No results found for \"Jane Do\" in 2025 or 2026. Suggestions: Jane Doe, Jane Dorn."
        );
        let error = compared_years("Jane Do", (2025, none(&[])), (2026, none(&["jane do"])))
            .unwrap_err()
            .to_string();
        assert_eq!(error, "No results found for \"Jane Do\" in 2025 or 2026.");
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
