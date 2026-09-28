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
            Lift, SINCLAIR_LABEL, attempt_habits, average, bombed_out, number, percent, points,
            row_sinclair,
        },
    },
};

/// Earlier editions of a meet compared, at most.
pub const EDITIONS: i32 = 3;
/// Lifters in the top-Sinclair table.
pub const TOP_SINCLAIR: usize = 10;

/// Show a meet's results and statistics: every result with its Sinclair, the heaviest lifts, the
/// top Sinclair lifters, bomb-outs, make rates by attempt, and how the meet compares with its
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
    pub best_sinclair: Option<(f64, String)>,
}

pub fn summarize(rows: &[LiftingResults]) -> MeetSummary {
    let all: Vec<&LiftingResults> = rows.iter().collect();
    let totals: Vec<f64> = rows
        .iter()
        .filter(|r| r.total > 0.0)
        .map(|r| r.total)
        .collect();
    let (mut taken, mut made) = (0, 0);
    for lift in [Lift::Snatch, Lift::CleanAndJerk] {
        let habits = attempt_habits(&all, lift);
        taken += habits.taken.iter().sum::<usize>();
        made += habits.made.iter().sum::<usize>();
    }
    let best_sinclair = rows
        .iter()
        .filter_map(|row| row_sinclair(row).map(|score| (score, row.name.clone())))
        .max_by(|a, b| a.0.total_cmp(&b.0));
    MeetSummary {
        athletes: rows.len(),
        bomb_outs: rows.iter().filter(|row| bombed_out(row)).count(),
        average_total: average(&totals),
        make_rate: (taken > 0).then(|| made as f64 * 100.0 / taken as f64),
        best_sinclair,
    }
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
    for (label, value) in [
        (
            "Snatch",
            (|r: &LiftingResults| r.snatch_best) as fn(&LiftingResults) -> f64,
        ),
        ("C&J", |r: &LiftingResults| r.cj_best),
        ("Total", |r: &LiftingResults| r.total),
    ] {
        if let Some(row) = results
            .iter()
            .filter(|r| value(r) > 0.0)
            .max_by(|a, b| value(a).total_cmp(&value(b)))
        {
            heaviest.add_row(vec![
                label.to_string(),
                number(value(row)),
                row.name.clone(),
                row.age.clone(),
            ]);
        }
    }

    let mut ranked: Vec<(&LiftingResults, f64)> = results
        .iter()
        .filter_map(|row| row_sinclair(row).map(|score| (row, score)))
        .collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
    let mut top = Table::new();
    top.set_header(vec![
        "Rank",
        "Athlete",
        "Division",
        "BW",
        "Total",
        SINCLAIR_LABEL,
    ]);
    for (rank, (row, score)) in (1..).zip(ranked.into_iter().take(TOP_SINCLAIR)) {
        top.add_row(vec![
            rank.to_string(),
            row.name.clone(),
            row.age.clone(),
            number(row.body_weight),
            number(row.total),
            format!("{score:.2}"),
        ]);
    }

    let (by_attempt, by_lift) = make_rate_tables(results);
    let mut report = Report::new()
        .table("results", meet_table)
        .headed("summary", "SUMMARY", summary_table)
        .headed("heaviest_lifts", "HEAVIEST LIFTS", heaviest)
        .headed("top_sinclair", "TOP SINCLAIR", top)
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
            "Best Sinclair",
            "Best Sinclair Athlete",
        ]);
        for (meet, summary) in editions {
            history.add_row(vec![
                meet.clone(),
                summary.athletes.to_string(),
                summary
                    .average_total
                    .map(|v| format!("{v:.1}"))
                    .unwrap_or_default(),
                percent(summary.make_rate),
                summary.bomb_outs.to_string(),
                points(summary.best_sinclair.as_ref().map(|(score, _)| *score)),
                summary
                    .best_sinclair
                    .as_ref()
                    .map(|(_, name)| name.clone())
                    .unwrap_or_default(),
            ]);
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
            summary.best_sinclair.as_ref().map(|(_, n)| n.as_str()),
            Some("Ada")
        );

        let json = report(&rows, &[("M".into(), summary)]).to_json();
        assert_eq!(json["heaviest_lifts"][2]["athlete"], "Ada");
        assert_eq!(json["top_sinclair"].as_array().unwrap().len(), 1);
        assert!(json.get("editions").is_none());
    }
}
