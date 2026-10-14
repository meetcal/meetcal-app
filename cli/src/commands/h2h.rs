use anyhow::{Result, bail};
use chrono::Utc;
use clap::Parser;
use comfy_table::Table;

use crate::types::lifting_results::LiftingResults;
use crate::utils::athletes::history;
use crate::utils::bests::{YEAR_BESTS_YEARS, cutoff_date};
use crate::utils::format::us_date;
use crate::utils::meet_names::result_year;
use crate::utils::output::{self, Report};
use crate::utils::stats::{
    Lift, SINCLAIR_LABEL, chronological, fold, number, points, row_qpoints, row_sinclair,
    valid_lift, valid_total,
};

/// Compare two athletes head to head: the meets they both entered, who totalled more at each, and
/// their best lifts all time and over the past year.
#[derive(Parser)]
#[command(
    name = "h2h",
    after_help = r#"Examples:
  meetcal h2h "Brandon Victorian" "Edward Ginnan""#
)]
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
    // UTC, as the past-year bests in `meet` and `qualify` (and the app's start list) count it,
    // so the three agree.
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

/// The meets both athletes entered, oldest first: the same meet name in the same year. A results
/// row's date is the day that athlete lifted, so at a multi-day meet the two dates can differ;
/// the year keeps apart the editions of a meet held under one name every year. An athlete with
/// two rows at one meet (two divisions) is represented by the higher total.
pub fn meetings<'a>(first: &'a [LiftingResults], second: &'a [LiftingResults]) -> Vec<Meeting<'a>> {
    let second = best_per_meet(second);
    best_per_meet(first)
        .into_iter()
        .filter_map(|a| {
            second
                .iter()
                .find(|b| meet_key(b) == meet_key(a))
                .map(|b| Meeting {
                    first: a,
                    second: b,
                })
        })
        .collect()
}

fn meet_key(row: &LiftingResults) -> (String, String) {
    (fold(&row.meet), result_year(row))
}

/// Each meet's row with the highest total, oldest first.
fn best_per_meet(rows: &[LiftingResults]) -> Vec<&LiftingResults> {
    let mut best: Vec<&LiftingResults> = Vec::new();
    for row in chronological(rows) {
        match best.iter_mut().find(|kept| meet_key(kept) == meet_key(row)) {
            Some(kept) if row.total > kept.total => *kept = row,
            Some(_) => {}
            None => best.push(row),
        }
    }
    best
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
    // The table names its columns after the athletes and packs each total with its division;
    // the export has fixed keys and one value a column.
    let mut data = Table::new();
    data.set_header(vec![
        "Date",
        "Meet",
        "First Athlete",
        "First Total",
        "First Division",
        "Second Athlete",
        "Second Total",
        "Second Division",
        "Higher Total",
        "Margin",
    ]);
    let (mut first_wins, mut second_wins) = (0, 0);
    for meeting in &meetings {
        let (a, b) = (meeting.first.total, meeting.second.total);
        // A source error's total decides nothing (`stats::plausible`).
        let winner = match (valid_total(meeting.first), valid_total(meeting.second)) {
            (None, _) if a > 0.0 => "Unknown (source error)".into(),
            (_, None) if b > 0.0 => "Unknown (source error)".into(),
            _ if a > b => {
                first_wins += 1;
                first_name.clone()
            }
            _ if b > a => {
                second_wins += 1;
                second_name.clone()
            }
            _ => "Tie".into(),
        };
        table.add_row(vec![
            us_date(&meeting.first.date),
            meeting.first.meet.clone(),
            format!("{} ({})", number(a), meeting.first.age),
            format!("{} ({})", number(b), meeting.second.age),
            winner.clone(),
            number((a - b).abs()),
        ]);
        data.add_row(vec![
            meeting.first.date.clone(),
            meeting.first.meet.clone(),
            first_name.clone(),
            number(a),
            meeting.first.age.clone(),
            second_name.clone(),
            number(b),
            meeting.second.age.clone(),
            winner,
            number((a - b).abs()),
        ]);
    }

    let mut summary = Table::new();
    summary.set_header(vec![
        "Athlete",
        "Higher Total In",
        "Meets Entered By Both",
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
        let max =
            |f: fn(&LiftingResults) -> Option<f64>| rows.iter().filter_map(f).fold(0.0, f64::max);
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
            .filter_map(valid_total)
            .fold(0.0, f64::max);
        summary.add_row(vec![
            name.clone(),
            wins.to_string(),
            meetings.len().to_string(),
            number(max(|r| valid_lift(r, Lift::Snatch))),
            number(max(|r| valid_lift(r, Lift::CleanAndJerk))),
            number(max(valid_total)),
            points(best_sinclair),
            points(best_qpoints),
            number(recent),
        ]);
    }

    Report::new()
        .titled(format!("HEAD TO HEAD — {first_name} vs {second_name}"))
        .headed_with_data("meetings", "MEETS ENTERED BY BOTH", table, data)
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
        let meeting = &json["meetings"][0];
        assert_eq!(meeting["date"], "2025-06-01");
        assert_eq!(meeting["first_athlete"], "Ada");
        assert_eq!(meeting["first_total"], 190);
        assert_eq!(meeting["first_division"], "Open Women's 64kg");
        assert_eq!(meeting["second_athlete"], "Bea");
        assert_eq!(meeting["second_total"], 194);
        assert_eq!(meeting["higher_total"], "Bea");
        assert_eq!(meeting["margin"], 4);
        assert_eq!(json["summary"][1]["higher_total_in"], 1);
        assert_eq!(json["summary"][1]["meets_entered_by_both"], 1);
        assert_eq!(json["summary"][1]["best_total"], 205);
    }

    #[test]
    fn a_source_error_decides_no_meeting_and_sets_no_best() {
        let a = vec![row(
            "Ada",
            "2026-04-04",
            "Showdown",
            "Open Men's 89kg",
            88.0,
            [-63.0, 633.0, 65.0],
            [85.0, 90.0, -95.0],
        )];
        let b = vec![row(
            "Bea",
            "2026-04-04",
            "Showdown",
            "Open Men's 89kg",
            88.0,
            [100.0, 0.0, 0.0],
            [120.0, 0.0, 0.0],
        )];
        let json = report(&a, &b, "2026-01-01").to_json();
        assert_eq!(
            json["meetings"][0]["higher_total"],
            "Unknown (source error)"
        );
        assert_eq!(json["summary"][0]["higher_total_in"], 0);
        assert_eq!(json["summary"][0]["meets_entered_by_both"], 1);
        assert_eq!(json["summary"][0]["best_snatch"], 0);
        assert_eq!(json["summary"][0]["best_total"], 0);
        assert_eq!(json["summary"][1]["best_total"], 220);
    }

    #[test]
    fn athletes_lifting_on_different_days_of_one_meet_met() {
        let lift = |name: &str, date: &str, meet: &str, age: &str, cj: f64| {
            row(
                name,
                date,
                meet,
                age,
                88.0,
                [140.0, 0.0, 0.0],
                [cj, 0.0, 0.0],
            )
        };
        let nationals = "2025 USA Weightlifting National Championships";
        let a = vec![
            lift("Ada", "2025-06-28", nationals, "Open Men's 89kg", 180.0),
            lift("Ada", "2025-06-28", nationals, "Junior Men's 89kg", 180.0),
            lift(
                "Ada",
                "2024-03-16",
                "Leprechaun Lift-off",
                "Open Men's 89kg",
                170.0,
            ),
        ];
        let b = vec![
            lift("Bo", "2025-06-27", nationals, "Open Men's 89kg", 185.0),
            // The same meet name a year later is another edition.
            lift(
                "Bo",
                "2025-03-15",
                "Leprechaun Lift-off",
                "Open Men's 89kg",
                170.0,
            ),
        ];
        let found = meetings(&a, &b);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].second.date, "2025-06-27");
        let json = report(&a, &b, "2025-01-01").to_json();
        assert_eq!(json["summary"][1]["higher_total_in"], 1);
    }
}
