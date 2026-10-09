use anyhow::Result;
use clap::Parser;
use comfy_table::Table;

use crate::types::lifting_results::LiftingResults;
use crate::utils::athletes::history;
use crate::utils::format::us_date;
use crate::utils::output::{self, Report};
use crate::utils::stats::{
    Lift, QPOINTS_LABEL, SINCLAIR_LABEL, attempt_habits, bombed_out, chronological, number,
    percent, points, pr_flags, row_qpoints, row_sinclair, signed_kg,
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

    let mut results = Table::new();
    results.set_header(vec![
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
    ]);
    for (row, flags) in &shown {
        results.add_row(vec![
            us_date(&row.date),
            row.meet.clone(),
            row.age.clone(),
            number(row.body_weight),
            number(row.snatch_best),
            number(row.cj_best),
            number(row.total),
            points(row_sinclair(row)),
            points(row_qpoints(row)),
            flags.marks(),
        ]);
    }

    Report::new()
        .titled(format!("PROGRESSION — {name}"))
        .table("results", results)
        .headed("trend", "TREND", trend(&rows))
        .headed("attempts", "ATTEMPT HABITS", attempts(&rows))
        .when_empty(format!("No results for {name} in that range."))
}

fn trend(rows: &[&LiftingResults]) -> Table {
    let totals: Vec<&&LiftingResults> = rows.iter().filter(|row| row.total > 0.0).collect();
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

    let mut table = Table::new();
    table.set_header(vec![
        "Meets",
        "First Meet",
        "Latest Total",
        "Best Total",
        "Best Total Date",
        "Best Sinclair",
        "Best Q-points",
        "First-to-Latest Total",
        "Bomb-outs",
    ]);
    table.add_row(vec![
        rows.len().to_string(),
        rows.first()
            .map(|row| us_date(&row.date))
            .unwrap_or_default(),
        totals
            .last()
            .map(|row| number(row.total))
            .unwrap_or_default(),
        best.map(|row| number(row.total)).unwrap_or_default(),
        best.map(|row| us_date(&row.date)).unwrap_or_default(),
        points(best_sinclair.map(|(score, _)| score)),
        points(best_qpoints),
        signed_kg(change),
        format!("{bombs} of {}", rows.len()),
    ]);
    table
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
        assert_eq!(trend["bomb_outs"], "0 of 1");
    }
}
