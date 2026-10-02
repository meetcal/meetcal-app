use anyhow::{Result, bail};
use chrono::Utc;
use clap::Parser;
use comfy_table::Table;

use crate::types::lifting_results::LiftingResults;
use crate::utils::athletes::history;
use crate::utils::bests::{YEAR_BESTS_YEARS, cutoff_date};
use crate::utils::format::us_date;
use crate::utils::output::{self, Report};
use crate::utils::stats::{
    SINCLAIR_LABEL, chronological, fold, number, points, row_qpoints, row_sinclair,
};

/// Compare two athletes head to head: the meets they both entered, who totalled more at each, and
/// their best lifts all time and over the past year.
///
/// Examples:
///   meetcal h2h "Brandon Victorian" "Edward Ginnan"
#[derive(Parser)]
#[command(name = "h2h")]
pub struct H2hArgs {
    /// First athlete (exact name)
    pub first: String,

    /// Second athlete (exact name)
    pub second: String,
}

pub async fn run(args: H2hArgs) -> Result<()> {
    if fold(&args.first) == fold(&args.second) {
        bail!("Pick two different athletes");
    }
    let first = history(&args.first).await?;
    let second = history(&args.second).await?;
    let cutoff = cutoff_date(Utc::now().date_naive(), YEAR_BESTS_YEARS);
    output::emit(report(&first, &second, &cutoff));
    Ok(())
}

/// One meet both athletes entered.
#[derive(Debug)]
pub struct Meeting<'a> {
    pub first: &'a LiftingResults,
    pub second: &'a LiftingResults,
}

/// The meets both athletes entered (same meet name and date), oldest first.
pub fn meetings<'a>(first: &'a [LiftingResults], second: &'a [LiftingResults]) -> Vec<Meeting<'a>> {
    chronological(first)
        .into_iter()
        .filter_map(|a| {
            second
                .iter()
                .find(|b| b.date == a.date && fold(&b.meet) == fold(&a.meet))
                .map(|b| Meeting {
                    first: a,
                    second: b,
                })
        })
        .collect()
}

pub fn report(first: &[LiftingResults], second: &[LiftingResults], cutoff: &str) -> Report {
    let first_name = first[0].name.clone();
    let second_name = second[0].name.clone();
    let meetings = meetings(first, second);

    let mut table = Table::new();
    table.set_header(vec![
        "Date",
        "Meet",
        first_name.as_str(),
        second_name.as_str(),
        "Higher Total",
        "Margin",
    ]);
    let (mut first_wins, mut second_wins) = (0, 0);
    for meeting in &meetings {
        let (a, b) = (meeting.first.total, meeting.second.total);
        let winner = if a > b {
            first_wins += 1;
            first_name.clone()
        } else if b > a {
            second_wins += 1;
            second_name.clone()
        } else {
            "Tie".into()
        };
        table.add_row(vec![
            us_date(&meeting.first.date),
            meeting.first.meet.clone(),
            format!("{} ({})", number(a), meeting.first.age),
            format!("{} ({})", number(b), meeting.second.age),
            winner,
            number((a - b).abs()),
        ]);
    }

    let mut summary = Table::new();
    summary.set_header(vec![
        "Athlete",
        "Higher Total In",
        "Best Snatch",
        "Best C&J",
        "Best Total",
        &format!("Best {SINCLAIR_LABEL}"),
        "Best Q-points",
        "Past-Year Best Total",
    ]);
    for (name, rows, wins) in [
        (&first_name, first, first_wins),
        (&second_name, second, second_wins),
    ] {
        let max = |f: fn(&LiftingResults) -> f64| rows.iter().map(f).fold(0.0, f64::max);
        let best_sinclair = rows
            .iter()
            .filter_map(row_sinclair)
            .fold(None, |best: Option<f64>, s| {
                Some(best.map_or(s, |b| b.max(s)))
            });
        let best_qpoints = rows
            .iter()
            .filter_map(row_qpoints)
            .fold(None, |best: Option<f64>, q| {
                Some(best.map_or(q, |b| b.max(q)))
            });
        let recent = rows
            .iter()
            .filter(|row| row.date.as_str() >= cutoff)
            .map(|row| row.total)
            .fold(0.0, f64::max);
        summary.add_row(vec![
            name.clone(),
            format!("{wins} of {}", meetings.len()),
            number(max(|r| r.snatch_best)),
            number(max(|r| r.cj_best)),
            number(max(|r| r.total)),
            points(best_sinclair),
            points(best_qpoints),
            number(recent),
        ]);
    }

    Report::new()
        .titled(format!("HEAD TO HEAD — {first_name} vs {second_name}"))
        .headed("meetings", "MEETS ENTERED BY BOTH", table)
        .headed("summary", "SUMMARY", summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::stats::tests::row;

    #[test]
    fn meetings_are_shared_meets_and_totals_decide_them() {
        let a = vec![
            row(
                "Ada",
                "2025-03-01",
                "Open A",
                "Open Women's 64kg",
                63.0,
                [80.0, 0.0, 0.0],
                [100.0, 0.0, 0.0],
            ),
            row(
                "Ada",
                "2025-06-01",
                "Nationals",
                "Open Women's 64kg",
                63.0,
                [85.0, 0.0, 0.0],
                [105.0, 0.0, 0.0],
            ),
        ];
        let b = vec![
            row(
                "Bea",
                "2025-06-01",
                "nationals",
                "Open Women's 64kg",
                64.0,
                [84.0, 0.0, 0.0],
                [110.0, 0.0, 0.0],
            ),
            row(
                "Bea",
                "2025-09-01",
                "Open B",
                "Open Women's 64kg",
                64.0,
                [90.0, 0.0, 0.0],
                [115.0, 0.0, 0.0],
            ),
        ];
        assert_eq!(meetings(&a, &b).len(), 1);
        let json = report(&a, &b, "2025-01-01").to_json();
        assert_eq!(json["meetings"][0]["higher_total"], "Bea");
        assert_eq!(json["meetings"][0]["margin"], 4);
        assert_eq!(json["summary"][1]["higher_total_in"], "1 of 1");
        assert_eq!(json["summary"][1]["best_total"], 205);
    }
}
