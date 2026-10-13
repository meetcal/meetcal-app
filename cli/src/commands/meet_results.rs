use anyhow::Result;
use clap::Parser;
use comfy_table::Table;

use crate::{
    types::lifting_results::LiftingResults,
    utils::{
        backend::{queries, query},
        make_rate::make_rate_tables,
        names::{NameKind, not_found},
        output::{self, Report},
        stats::{
            Division, Gender, Lift, QPOINTS_LABEL, SINCLAIR_LABEL, attempt_habits, average,
            bombed_out, number, percent, points, row_qpoints, row_sinclair, valid_lift,
            valid_total,
        },
    },
};

/// Earlier editions of a meet compared, at most.
pub const EDITIONS: i32 = 3;
/// Lifters in the top-Sinclair table.
pub const TOP_SINCLAIR: usize = 10;

/// Show a meet's results and statistics: every result with its Sinclair, the heaviest lifts, the
/// top Q-points and Sinclair lifters (men and women apart), bomb-outs, make rates by attempt, and how the meet compares with its
/// previous editions.
///
/// Examples:
///   meetcal meet-results "2026 AZ Summer Slam Nationals Qualifier"
///   meetcal meet-results "2026 Ohio WSO Championships" --no-history
#[derive(Parser)]
#[command(name = "meet-results")]
pub struct MeetResultsArgs {
    /// Meet to search for
    pub name: String,

    /// Skip the comparison with the meet's previous editions (up to three lookups)
    #[arg(long)]
    pub no_history: bool,
}

pub async fn run(args: MeetResultsArgs) -> Result<()> {
    let name = args.name;
    let results = meet_rows(&name).await?;
    if results.is_empty() {
        let message = format!("No results found for meet \"{name}\"");
        return Err(not_found(NameKind::Meet, &name, message).await);
    }

    let mut editions = vec![(name.clone(), summarize(&results))];
    if !args.no_history {
        for earlier in earlier_editions(&name) {
            let rows = meet_rows(&earlier).await?;
            if !rows.is_empty() {
                editions.push((earlier, summarize(&rows)));
            }
        }
    }

    output::emit(report(&results, &editions));
    Ok(())
}

async fn meet_rows(meet: &str) -> Result<Vec<LiftingResults>> {
    query(queries::MEET_RESULTS, &serde_json::json!({ "meet": meet })).await
}

/// The same meet in each of the three years before, by its name's year: `2026 Ohio WSO
/// Championships` gives `2025 Ohio WSO Championships`, and so on. None without a year.
pub fn earlier_editions(meet: &str) -> Vec<String> {
    let Some((index, year)) = year_in(meet) else {
        return Vec::new();
    };
    (1..=EDITIONS)
        .map(|back| format!("{}{}{}", &meet[..index], year - back, &meet[index + 4..]))
        .collect()
}

fn year_in(meet: &str) -> Option<(usize, i32)> {
    let bytes = meet.as_bytes();
    (0..bytes.len().saturating_sub(3)).find_map(|i| {
        let candidate = &meet[i..i + 4];
        let bounded = (i == 0 || !bytes[i - 1].is_ascii_digit())
            && bytes.get(i + 4).is_none_or(|b| !b.is_ascii_digit());
        let year: i32 = candidate.parse().ok()?;
        (bounded && candidate.bytes().all(|b| b.is_ascii_digit()) && (1950..=2100).contains(&year))
            .then_some((i, year))
    })
}

/// A meet's headline numbers.
#[derive(Clone, Debug, PartialEq)]
pub struct MeetSummary {
    pub athletes: usize,
    pub bomb_outs: usize,
    pub average_total: Option<f64>,
    pub make_rate: Option<f64>,
    /// The best Sinclair and Q-points score and who scored it, men's and women's apart: each
    /// gender has its own scale.
    pub best_sinclair: [Option<(f64, String)>; 2],
    pub best_qpoints: [Option<(f64, String)>; 2],
}

/// The genders scores are ranked within, in report order.
const GENDERS: [Gender; 2] = [Gender::Men, Gender::Women];

pub fn summarize(rows: &[LiftingResults]) -> MeetSummary {
    let all: Vec<&LiftingResults> = rows.iter().collect();
    // Source errors (`stats::plausible`) count as athletes, but not toward the average total.
    let totals: Vec<f64> = rows.iter().filter_map(valid_total).collect();
    let (mut taken, mut made) = (0, 0);
    for lift in [Lift::Snatch, Lift::CleanAndJerk] {
        let habits = attempt_habits(&all, lift);
        taken += habits.taken.iter().sum::<usize>();
        made += habits.made.iter().sum::<usize>();
    }
    let best = |score: fn(&LiftingResults) -> Option<f64>, gender: Gender| {
        rows.iter()
            .filter(|row| Division::parse(&row.age).gender == gender)
            .filter_map(|row| score(row).map(|value| (value, row.name.clone())))
            .max_by(|a, b| a.0.total_cmp(&b.0))
    };
    MeetSummary {
        athletes: rows.len(),
        bomb_outs: rows.iter().filter(|row| bombed_out(row)).count(),
        average_total: average(&totals),
        make_rate: (taken > 0).then(|| made as f64 * 100.0 / taken as f64),
        best_sinclair: GENDERS.map(|gender| best(row_sinclair, gender)),
        best_qpoints: GENDERS.map(|gender| best(row_qpoints, gender)),
    }
}

/// The meet's best lifters of `gender` by `score`, best first.
fn top_table(
    results: &[LiftingResults],
    score: fn(&LiftingResults) -> Option<f64>,
    label: &str,
    gender: Gender,
) -> Table {
    let mut ranked: Vec<(&LiftingResults, f64)> = results
        .iter()
        .filter(|row| Division::parse(&row.age).gender == gender)
        .filter_map(|row| score(row).map(|value| (row, value)))
        .collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
    let mut top = Table::new();
    top.set_header(vec!["Rank", "Athlete", "Division", "BW", "Total", label]);
    for (rank, (row, value)) in (1..).zip(ranked.into_iter().take(TOP_SINCLAIR)) {
        top.add_row(vec![
            rank.to_string(),
            row.name.clone(),
            row.age.clone(),
            number(row.body_weight),
            number(row.total),
            format!("{value:.2}"),
        ]);
    }
    top
}

pub fn report(results: &[LiftingResults], editions: &[(String, MeetSummary)]) -> Report {
    let mut sorted: Vec<&LiftingResults> = results.iter().collect();
    sorted.sort_by(|a, b| b.total.total_cmp(&a.total));

    let mut meet_table = Table::new();
    meet_table.set_header(vec![
        "Name",
        "Class",
        "BW",
        "Adaptive",
        "Sn1",
        "Sn2",
        "Sn3",
        "CJ1",
        "CJ2",
        "CJ3",
        "Total",
        SINCLAIR_LABEL,
        QPOINTS_LABEL,
    ]);
    for result in &sorted {
        meet_table.add_row(vec![
            result.name.to_string(),
            result.age.to_string(),
            result.body_weight.to_string(),
            result.adaptive.to_string(),
            result.snatch1.to_string(),
            result.snatch2.to_string(),
            result.snatch3.to_string(),
            result.cj1.to_string(),
            result.cj2.to_string(),
            result.cj3.to_string(),
            result.total.to_string(),
            points(row_sinclair(result)),
            points(row_qpoints(result)),
        ]);
    }

    let summary = &editions[0].1;
    let mut summary_table = Table::new();
    summary_table.set_header(vec![
        "Athletes",
        "Bomb-outs",
        "Bomb-out Rate",
        "Average Total",
        "Make Rate",
    ]);
    summary_table.add_row(vec![
        summary.athletes.to_string(),
        summary.bomb_outs.to_string(),
        percent(
            (summary.athletes > 0)
                .then(|| summary.bomb_outs as f64 * 100.0 / summary.athletes as f64),
        ),
        summary
            .average_total
            .map(|v| format!("{v:.1}"))
            .unwrap_or_default(),
        percent(summary.make_rate),
    ]);

    let mut heaviest = Table::new();
    heaviest.set_header(vec!["Lift", "Weight", "Athlete", "Division"]);
    // The heaviest lifts leave out source errors (`stats::plausible`).
    for (label, value) in [
        (
            "Snatch",
            (|r: &LiftingResults| valid_lift(r, Lift::Snatch))
                as fn(&LiftingResults) -> Option<f64>,
        ),
        ("C&J", |r: &LiftingResults| {
            valid_lift(r, Lift::CleanAndJerk)
        }),
        ("Total", valid_total),
    ] {
        if let Some((row, weight)) = results
            .iter()
            .filter_map(|r| value(r).map(|weight| (r, weight)))
            .max_by(|a, b| a.1.total_cmp(&b.1))
        {
            heaviest.add_row(vec![
                label.to_string(),
                number(weight),
                row.name.clone(),
                row.age.clone(),
            ]);
        }
    }

    let (by_attempt, by_lift) = make_rate_tables(results);
    let mut report = Report::new()
        .table("results", meet_table)
        .headed("summary", "SUMMARY", summary_table)
        .headed("heaviest_lifts", "HEAVIEST LIFTS", heaviest);
    // Men and women score on separate scales, so each is ranked on its own. Q-points skip youth
    // divisions (USAW scores them with Q-Youth) and carry no Masters age factors (Q-Masters), so
    // this is not USAW's best-lifter result for those.
    for (score, label, key, heading) in [
        (
            row_qpoints as fn(&LiftingResults) -> Option<f64>,
            QPOINTS_LABEL,
            "top_qpoints",
            "TOP Q-POINTS",
        ),
        (row_sinclair, SINCLAIR_LABEL, "top_sinclair", "TOP SINCLAIR"),
    ] {
        for gender in GENDERS {
            let note = if key == "top_qpoints" {
                " (juniors, seniors and Masters without age factors; no youth)"
            } else {
                ""
            };
            report = report.headed(
                &format!("{key}_{}", gender.label().to_lowercase()),
                format!("{heading} — {}{note}", gender.label().to_uppercase()),
                top_table(results, score, label, gender),
            );
        }
    }
    report = report
        .headed("make_rate_by_attempt", "MAKE RATES", by_attempt)
        .table("make_rate", by_lift);

    if editions.len() > 1 {
        let mut history = Table::new();
        history.set_header(vec![
            "Meet",
            "Athletes",
            "Average Total",
            "Make Rate",
            "Bomb-outs",
            "Best Sinclair Men",
            "Best Sinclair Men Athlete",
            "Best Sinclair Women",
            "Best Sinclair Women Athlete",
            "Best Q-points Men",
            "Best Q-points Men Athlete",
            "Best Q-points Women",
            "Best Q-points Women Athlete",
        ]);
        for (meet, summary) in editions {
            let mut cells = vec![
                meet.clone(),
                summary.athletes.to_string(),
                summary
                    .average_total
                    .map(|v| format!("{v:.1}"))
                    .unwrap_or_default(),
                percent(summary.make_rate),
                summary.bomb_outs.to_string(),
            ];
            for best in summary.best_sinclair.iter().chain(&summary.best_qpoints) {
                cells.push(points(best.as_ref().map(|(score, _)| *score)));
                cells.push(
                    best.as_ref()
                        .map(|(_, name)| name.clone())
                        .unwrap_or_default(),
                );
            }
            history.add_row(cells);
        }
        report = report.headed("editions", "THIS MEET IN EARLIER YEARS", history);
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::stats::tests::row;

    #[test]
    fn earlier_editions_change_the_year() {
        assert_eq!(
            earlier_editions("2026 Ohio WSO Championships"),
            [
                "2025 Ohio WSO Championships",
                "2024 Ohio WSO Championships",
                "2023 Ohio WSO Championships"
            ]
        );
        assert_eq!(
            earlier_editions("The 2026 DMV WSO Championships")[0],
            "The 2025 DMV WSO Championships"
        );
        assert!(earlier_editions("Summer Open").is_empty());
        assert!(earlier_editions("Meet 12345").is_empty());
    }

    #[test]
    fn summary_counts_bombs_makes_and_the_best_sinclair() {
        let rows = vec![
            row(
                "Ada",
                "2026-01-01",
                "M",
                "Open Women's 64kg",
                63.0,
                [80.0, -85.0, 85.0],
                [100.0, 105.0, -110.0],
            ),
            row(
                "Bo",
                "2026-01-01",
                "M",
                "Open Men's 89kg",
                88.0,
                [-120.0, -120.0, -120.0],
                [150.0, 0.0, 0.0],
            ),
        ];
        let summary = summarize(&rows);
        assert_eq!(summary.athletes, 2);
        assert_eq!(summary.bomb_outs, 1);
        assert_eq!(summary.average_total, Some(190.0));
        // 5 made of 10 taken.
        assert_eq!(summary.make_rate, Some(50.0));
        assert_eq!(
            summary.best_sinclair[1].as_ref().map(|(_, n)| n.as_str()),
            Some("Ada")
        );
        // Bo bombed out: no men's score.
        assert_eq!(summary.best_sinclair[0], None);

        let json = report(&rows, &[("M".into(), summary)]).to_json();
        assert_eq!(json["heaviest_lifts"][2]["athlete"], "Ada");
        assert_eq!(json["top_sinclair_women"].as_array().unwrap().len(), 1);
        assert_eq!(json["top_sinclair_men"].as_array().unwrap().len(), 0);
        assert!(json.get("editions").is_none());
    }

    #[test]
    fn men_and_women_are_ranked_apart_and_source_errors_lead_nothing() {
        let rows = vec![
            row(
                "Hampton",
                "2026-06-28",
                "M",
                "Open Men's 65kg",
                64.5,
                [140.0, 0.0, 0.0],
                [175.0, 0.0, 0.0],
            ),
            row(
                "Olivia",
                "2026-06-28",
                "M",
                "Open Women's 77kg",
                76.0,
                [115.0, 0.0, 0.0],
                [145.0, 0.0, 0.0],
            ),
            row(
                "Gunner",
                "2026-06-28",
                "M",
                "Men's 14-15 Age Group 79+kg",
                90.8,
                [-63.0, 633.0, 65.0],
                [85.0, 90.0, -95.0],
            ),
        ];
        let summary = summarize(&rows);
        assert_eq!(summary.average_total, Some(287.5));
        let json = report(&rows, &[("M".into(), summary)]).to_json();
        assert_eq!(json["top_qpoints_men"][0]["athlete"], "Hampton");
        assert_eq!(json["top_qpoints_women"][0]["athlete"], "Olivia");
        assert_eq!(json["top_sinclair_men"].as_array().unwrap().len(), 1);
        assert_eq!(json["heaviest_lifts"][0]["athlete"], "Hampton");
        assert_eq!(json["heaviest_lifts"][2]["weight"], 315);
    }
}
