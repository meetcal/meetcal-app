use anyhow::{Result, bail};
use clap::Parser;
use comfy_table::Table;

use crate::commands::wrapped::{
    calculate_wrapped_stats, current_year, filter_exact_name, get_athlete_year,
};
use crate::types::wrapped::WrappedStats;

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
    let current_results = filter_exact_name(&args.name, current_response.results);
    let previous_results = filter_exact_name(&args.name, previous_response.results);

    if current_results.is_empty() && previous_results.is_empty() {
        let mut suggestions = current_response.suggestions;
        suggestions.extend(previous_response.suggestions);
        suggestions.sort();
        suggestions.dedup();
        let suffix = if suggestions.is_empty() {
            String::new()
        } else {
            format!(" Suggestions: {}.", suggestions.join(", "))
        };
        bail!(
            "No results found for \"{}\" in {previous} or {current}.{suffix}",
            args.name
        );
    }

    let display_name = current_results
        .first()
        .or_else(|| previous_results.first())
        .map(|row| row.name.as_str())
        .unwrap_or(&args.name);
    let current_stats = calculate_wrapped_stats(&current_results);
    let previous_stats = calculate_wrapped_stats(&previous_results);
    println!(
        "{}",
        render_comparison(
            display_name,
            previous,
            current,
            &previous_stats,
            &current_stats,
        )
    );
    Ok(())
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
    let mut table = Table::new();
    table.set_header(vec![
        "Metric",
        previous_year.to_string().as_str(),
        current_year.to_string().as_str(),
        "% Difference",
    ]);

    for metric in comparisons(previous, current) {
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

    format!("{name} — {previous_year} VS {current_year} CALENDAR YEAR\n{table}")
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
            improvement_from_first: 0.0,
            consecutive_makes: 0,
            favorite_attempt: None,
            year_rank: "Rising Star",
        }
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
