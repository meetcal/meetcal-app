use std::collections::HashSet;

use anyhow::Result;
use clap::Parser;
use comfy_table::Table;

use crate::types::lifting_results::LiftingResults;
use crate::utils::athletes::history;
use crate::utils::format::us_date;
use crate::utils::output::{self, Report};
use crate::utils::stats::{
    Lift, QPOINTS_LABEL, SINCLAIR_LABEL, attempt_habits, bombed_out, chronological, fold, number,
    percent, points, pr_flags, row_qpoints, row_sinclair, signed_kg, valid_total,
};

/// Show an athlete's progression: every meet with its Sinclair and PRs, their trend, and their
/// attempt habits (make rate by attempt, jumps between attempts, openers, bomb-outs).
///
/// Examples:
///   meetcal progress "Brandon Victorian"
///   meetcal progress "Brandon Victorian" --since 2024
#[derive(Parser)]
#[command(name = "progress")]
pub struct ProgressArgs {
    /// Exact athlete name
    pub name: String,

    /// Only results from this year on
    #[arg(long, short = 's', value_parser = clap::value_parser!(i32).range(1900..=9999))]
    pub since: Option<i32>,
}

pub async fn run(args: ProgressArgs) -> Result<()> {
    let rows = history(&args.name).await?;
    let name = rows
        .first()
        .map(|row| row.name.clone())
        .unwrap_or(args.name.clone());
    output::emit(report(&name, &rows, args.since));
    Ok(())
}

pub fn report(name: &str, rows: &[LiftingResults], since: Option<i32>) -> Report {
    // PRs are judged against the whole history, then the table is cut to `since`.
    let all = chronological(rows);
    let flags = pr_flags(&all);
    let from = since.map(|year| format!("{year:04}-01-01"));
    let shown: Vec<(&LiftingResults, _)> = all
        .iter()
        .copied()
        .zip(flags)
        .filter(|(row, _)| from.as_deref().is_none_or(|from| row.date.as_str() >= from))
        .collect();
    let rows: Vec<&LiftingResults> = shown.iter().map(|(row, _)| *row).collect();

    let header = vec![
        "Date",
        "Meet",
        "Division",
        "BW",
        "Snatch",
        "C&J",
        "Total",
        SINCLAIR_LABEL,
        QPOINTS_LABEL,
        "PRs",
    ];
    // Shown with US dates, exported with ISO ones.
    let mut results = Table::new();
    results.set_header(header.clone());
    let mut results_data = Table::new();
    results_data.set_header(header);
    for (row, flags) in &shown {
        let cells = vec![
            row.meet.clone(),
            row.age.clone(),
            number(row.body_weight),
            number(row.snatch_best),
            number(row.cj_best),
            number(row.total),
            points(row_sinclair(row)),
            points(row_qpoints(row)),
            flags.marks(),
        ];
        results.add_row([vec![us_date(&row.date)], cells.clone()].concat());
        results_data.add_row([vec![row.date.clone()], cells].concat());
    }

    let (mut trend, mut trend_data) = trend(&rows);
    let mut attempts = attempts(&rows);
    if rows.is_empty() {
        // Nothing in the range: every table is empty, so table format shows the message and
        // JSON and CSV carry empty tables, not a row of zeros.
        for table in [&mut trend, &mut trend_data, &mut attempts] {
            *table = header_only(table);
        }
    }
    Report::new()
        .titled(format!("PROGRESSION — {name}"))
        .table_with_data("results", results, results_data)
        .headed_with_data("trend", "TREND", trend, trend_data)
        .headed("attempts", "ATTEMPT HABITS", attempts)
        .when_empty(format!("No results for {name} in that range."))
}

/// `table`'s header without its rows.
fn header_only(table: &Table) -> Table {
    let mut empty = Table::new();
    if let Some(header) = table.header() {
        empty.set_header(header.cell_iter().map(|cell| cell.content()));
    }
    empty
}

/// The trend as shown, and as exported (ISO dates, the bomb-outs as a count).
fn trend(rows: &[&LiftingResults]) -> (Table, Table) {
    // Source errors (`valid_total`) are neither the best nor the latest total.
    let totals: Vec<&&LiftingResults> = rows
        .iter()
        .filter(|row| valid_total(row).is_some())
        .collect();
    let best = totals.iter().max_by(|a, b| a.total.total_cmp(&b.total));
    let best_sinclair = rows
        .iter()
        .filter_map(|row| row_sinclair(row).map(|score| (score, row)))
        .max_by(|a, b| a.0.total_cmp(&b.0));
    let best_qpoints = rows
        .iter()
        .filter_map(|row| row_qpoints(row))
        .max_by(|a, b| a.total_cmp(b));
    let change = match (totals.first(), totals.last()) {
        (Some(first), Some(last)) if totals.len() > 1 => Some(last.total - first.total),
        _ => None,
    };
    let bombs = rows.iter().filter(|row| bombed_out(row)).count();
    // Meets, not result rows: an athlete entered in two divisions of one meet has two rows.
    let meets: HashSet<(String, &str)> = rows
        .iter()
        .map(|row| (fold(&row.meet), row.date.as_str()))
        .collect();

    let header = vec![
        "Meets",
        "First Meet",
        "Latest Total",
        "Best Total",
        "Best Total Date",
        "Best Sinclair",
        "Best Q-points",
        "First-to-Latest Total",
        "Bomb-outs",
    ];
    let first_date = rows.first().map(|row| row.date.clone()).unwrap_or_default();
    let best_date = best.map(|row| row.date.clone()).unwrap_or_default();
    let cells = |first_date: String, best_date: String, bombs: String| {
        vec![
            meets.len().to_string(),
            first_date,
            totals
                .last()
                .map(|row| number(row.total))
                .unwrap_or_default(),
            best.map(|row| number(row.total)).unwrap_or_default(),
            best_date,
            points(best_sinclair.map(|(score, _)| score)),
            points(best_qpoints),
            signed_kg(change),
            bombs,
        ]
    };

    let mut table = Table::new();
    table.set_header(header.clone());
    table.add_row(cells(
        us_date(&first_date),
        us_date(&best_date),
        format!("{bombs} of {}", rows.len()),
    ));
    let mut data = Table::new();
    data.set_header(header);
    data.add_row(cells(first_date, best_date, bombs.to_string()));
    (table, data)
}

/// Attempt habits for each lift: make rate by attempt, jumps, and openers.
pub fn attempts(rows: &[&LiftingResults]) -> Table {
    let mut table = Table::new();
    table.set_header(vec![
        "Lift",
        "1st Make Rate",
        "2nd Make Rate",
        "3rd Make Rate",
        "Avg Jump 1st-2nd",
        "Avg Jump 2nd-3rd",
        "Opener % of Best",
    ]);
    for lift in [Lift::Snatch, Lift::CleanAndJerk] {
        let habits = attempt_habits(rows, lift);
        table.add_row(vec![
            lift.label().to_string(),
            percent(habits.make_rate(0)),
            percent(habits.make_rate(1)),
            percent(habits.make_rate(2)),
            signed_kg(habits.jump_1_2),
            signed_kg(habits.jump_2_3),
            percent(habits.opener_share),
        ]);
    }
    table
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::stats::tests::row;

    #[test]
    fn report_marks_prs_and_cuts_to_since() {
        let rows = vec![
            row(
                "Ada",
                "2024-03-01",
                "M1",
                "Open Women's 64kg",
                63.0,
                [80.0, 85.0, -88.0],
                [100.0, 105.0, 0.0],
            ),
            row(
                "Ada",
                "2025-03-01",
                "M2",
                "Open Women's 64kg",
                63.5,
                [82.0, 86.0, 0.0],
                [102.0, -107.0, 107.0],
            ),
        ];
        let report = report("Ada", &rows, Some(2025));
        let json = report.to_json();
        let results = json["results"].as_array().unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0]["prs"], "S CJ T");
        assert_eq!(results[0]["total"], 193);
        let trend = &json["trend"][0];
        assert_eq!(trend["meets"], 1);
        assert_eq!(trend["bomb_outs"], 0);
        assert_eq!(results[0]["date"], "2025-03-01");
        assert_eq!(trend["first_meet"], "2025-03-01");
        assert_eq!(trend["best_total_date"], "2025-03-01");
        let text = report.to_text();
        assert!(text.contains("Mar 1, 2025"));
        assert!(text.contains("0 of 1"));
    }

    #[test]
    fn a_range_with_no_results_says_so() {
        let rows = vec![row(
            "Ada",
            "2024-03-01",
            "M1",
            "Open Women's 64kg",
            63.0,
            [80.0, 85.0, -88.0],
            [100.0, 105.0, 0.0],
        )];
        let report = report("Ada", &rows, Some(2026));
        assert_eq!(report.to_text(), "No results for Ada in that range.");
        let json = report.to_json();
        assert_eq!(json["results"], serde_json::json!([]));
        assert_eq!(json["trend"], serde_json::json!([]));
        assert_eq!(json["attempts"], serde_json::json!([]));
    }

    #[test]
    fn meets_count_meets_not_rows() {
        let entry = |division: &str| {
            row(
                "Ada",
                "2025-03-01",
                "M1",
                division,
                63.0,
                [80.0, 0.0, 0.0],
                [100.0, 0.0, 0.0],
            )
        };
        let rows = vec![entry("Open Women's 64kg"), entry("Junior Women's 64kg")];
        let json = report("Ada", &rows, None).to_json();
        assert_eq!(json["trend"][0]["meets"], 1);
    }

    #[test]
    fn a_source_error_total_is_not_the_best_or_latest() {
        let lift = |date: &str, snatch: [f64; 3], cj: [f64; 3]| {
            row("Ada", date, "M", "Open Men's 89kg", 88.0, snatch, cj)
        };
        let rows = vec![
            lift("2024-03-01", [70.0, 0.0, 0.0], [90.0, 0.0, 0.0]),
            lift("2025-03-01", [72.0, 0.0, 0.0], [96.0, 0.0, 0.0]),
            // 633 for 63: the source's best and total come from the typo.
            lift("2026-03-01", [-63.0, 633.0, 65.0], [90.0, 0.0, 0.0]),
        ];
        let json = report("Ada", &rows, None).to_json();
        let trend = &json["trend"][0];
        assert_eq!(trend["best_total"], 168);
        assert_eq!(trend["latest_total"], 168);
        assert_eq!(trend["first_to_latest_total"], 8);
    }
}
