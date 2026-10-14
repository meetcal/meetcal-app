use std::collections::BTreeMap;

use anyhow::{Result, bail};
use clap::Parser;
use comfy_table::Table;
use tokio::task::JoinSet;

use crate::{
    types::lifting_results::LiftingResults,
    utils::{
        backend::{queries, query},
        make_rate::make_rate_tables,
        meet_names::{SPONSOR_WORDS, editions_by_year, series_name},
        names::{MAX_NAME_PAGES, NameKind, just_before, meet_names_between, not_found},
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
/// top Q-points and Sinclair lifters (men and women apart), bomb-outs, make rates by attempt, and
/// how the meet compares with its previous editions.
///
/// A meet held every year under one name (no year in it) has a results edition per year: the
/// latest is shown, and `--year` picks another.
#[derive(Parser)]
#[command(
    name = "meet-results",
    after_help = r#"Examples:
  meetcal meet-results "2026 AZ Summer Slam Nationals Qualifier"
  meetcal meet-results "2026 Ohio WSO Championships" --no-history
  meetcal meet-results "Testify Leprechaun Lift-off" --year 2022"#
)]
pub struct MeetResultsArgs {
    /// Meet to search for
    pub name: String,

    /// The edition to show, by year, for a meet held under one name every year (default: the
    /// latest)
    #[arg(long)]
    pub year: Option<i32>,

    /// Skip the comparison with the meet's previous editions (a few lookups)
    #[arg(long)]
    pub no_history: bool,
}

/// One edition of a meet and its headline numbers.
#[derive(Clone, Debug, PartialEq)]
pub struct EditionSummary {
    pub meet: String,
    pub year: String,
    pub summary: MeetSummary,
}

pub async fn run(args: MeetResultsArgs) -> Result<()> {
    let name = args.name;
    let rows = meet_rows(&name).await?;
    if rows.is_empty() {
        let message = format!("No results found for meet \"{name}\"");
        return Err(not_found(NameKind::ResultsMeet, &name, message).await);
    }

    let mut years = editions_by_year(rows);
    let year = match args.year {
        Some(year) => year.to_string(),
        None => years.keys().last().cloned().unwrap_or_default(),
    };
    let Some(results) = years.remove(&year) else {
        let held: Vec<&str> = years.keys().map(String::as_str).collect();
        bail!(
            "\"{name}\" has no results in {year}. It has results in {}.",
            held.join(", ")
        );
    };
    let other_years: Vec<String> = years.keys().cloned().collect();

    let mut editions = vec![EditionSummary {
        meet: name.clone(),
        year: year.clone(),
        summary: summarize(&results),
    }];
    if !args.no_history {
        editions.extend(earlier_editions(&name, &year, years).await?);
    }

    output::emit(report(&results, &editions, &other_years, !args.no_history));
    Ok(())
}

async fn meet_rows(meet: &str) -> Result<Vec<LiftingResults>> {
    query(queries::MEET_RESULTS, &serde_json::json!({ "meet": meet })).await
}

/// The meet's editions in the [`EDITIONS`] years before `year`, newest first: the same name's
/// rows from earlier years (`same_name`), and meets whose names differ only in the year, "The",
/// punctuation or sponsor words ([`series_name`]), such as `2024 DMV WSO Championships` for
/// `The 2025 DMV WSO Championships`.
async fn earlier_editions(
    meet: &str,
    year: &str,
    same_name: BTreeMap<String, Vec<LiftingResults>>,
) -> Result<Vec<EditionSummary>> {
    let Ok(current) = year.parse::<i32>() else {
        return Ok(Vec::new());
    };
    let wanted = |edition_year: &str| {
        edition_year
            .parse::<i32>()
            .is_ok_and(|y| (current - EDITIONS..current).contains(&y))
    };
    let mut editions: Vec<EditionSummary> = same_name
        .into_iter()
        .filter(|(edition_year, _)| wanted(edition_year))
        .map(|(edition_year, rows)| EditionSummary {
            meet: meet.to_string(),
            year: edition_year,
            summary: summarize(&rows),
        })
        .collect();

    for candidate in edition_names(meet, current).await? {
        // A name with a year outside the window has no edition we want.
        if year_in(&candidate).is_some_and(|(_, y)| !(current - EDITIONS..current).contains(&y)) {
            continue;
        }
        for (edition_year, rows) in editions_by_year(meet_rows(&candidate).await?) {
            if wanted(&edition_year) {
                editions.push(EditionSummary {
                    meet: candidate.clone(),
                    year: edition_year,
                    summary: summarize(&rows),
                });
            }
        }
    }
    editions.sort_by(|a, b| b.year.cmp(&a.year).then_with(|| a.meet.cmp(&b.meet)));
    Ok(editions)
}

/// Other results meet names in the same series as `meet` ([`series_name`]). Only the name ranges
/// such a name can start in are listed: the earlier years (`2024 …`, `The 2024 …`) and the
/// series' first letter (`DMV … 2024`, `The DMV …`).
async fn edition_names(meet: &str, year: i32) -> Result<Vec<String>> {
    let series = series_name(meet);
    if series.is_empty() {
        return Ok(Vec::new());
    }
    let mut tasks = JoinSet::new();
    for prefix in name_prefixes(&series, year) {
        let after = Some(just_before(&prefix));
        let before = Some(format!("{prefix}\u{10FFFF}"));
        tasks.spawn(meet_names_between(
            "results",
            after,
            before,
            MAX_NAME_PAGES,
            false,
        ));
    }
    let mut names = Vec::new();
    while let Some(listed) = tasks.join_next().await {
        for name in listed?? {
            if name != meet && series_name(&name) == series && !names.contains(&name) {
                names.push(name);
            }
        }
    }
    names.sort();
    Ok(names)
}

/// How an earlier edition of a meet in `series` can begin: an earlier year, with or without
/// "The", the series' first letter in either case, with or without "The", or a sponsor word
/// [`series_name`] drops (`Nike 2024 USA Weightlifting National Championships`).
fn name_prefixes(series: &str, year: i32) -> Vec<String> {
    let mut prefixes = Vec::new();
    for earlier in year - EDITIONS..year {
        prefixes.push(earlier.to_string());
        prefixes.push(format!("The {earlier}"));
    }
    if let Some(first) = series.chars().next() {
        let upper: String = first.to_uppercase().collect();
        prefixes.push(format!("The {upper}"));
        prefixes.push(upper);
        prefixes.push(first.to_string());
    }
    for sponsor in SPONSOR_WORDS {
        let mut letters = sponsor.chars();
        let capitalized: String = letters
            .next()
            .map(|first| first.to_uppercase().chain(letters).collect())
            .unwrap_or_default();
        prefixes.push(format!("The {capitalized}"));
        prefixes.push(capitalized);
        prefixes.push(sponsor.to_uppercase());
        prefixes.push((*sponsor).to_string());
    }
    prefixes.dedup();
    prefixes
}

/// The first four-digit year in `meet` and its byte offset. Works on bytes, so a name with curly
/// quotes, accents or emoji never slices inside a character; the year itself is ASCII, so the
/// offset is a character boundary.
pub fn year_in(meet: &str) -> Option<(usize, i32)> {
    let bytes = meet.as_bytes();
    (0..bytes.len().saturating_sub(3)).find_map(|i| {
        let candidate = &bytes[i..i + 4];
        let bounded = (i == 0 || !bytes[i - 1].is_ascii_digit())
            && bytes.get(i + 4).is_none_or(|b| !b.is_ascii_digit());
        if !bounded || !candidate.iter().all(u8::is_ascii_digit) {
            return None;
        }
        let year = candidate
            .iter()
            .fold(0, |year, digit| year * 10 + i32::from(digit - b'0'));
        (1950..=2100).contains(&year).then_some((i, year))
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
            .filter(|row| Division::parse(&row.age).gender == Some(gender))
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
        .filter(|row| Division::parse(&row.age).gender == Some(gender))
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

/// The report for one edition's `results`. `editions` starts with this edition, then the earlier
/// ones found; `other_years` are the years this meet name has other results in. With `history`
/// (no `--no-history`) JSON and CSV always carry the `editions` table, which table format shows
/// only when there are earlier editions to compare.
pub fn report(
    results: &[LiftingResults],
    editions: &[EditionSummary],
    other_years: &[String],
    history: bool,
) -> Report {
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

    let summary = &editions[0].summary;
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

    if history {
        let mut history = Table::new();
        history.set_header(vec![
            "Year",
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
        for EditionSummary {
            meet,
            year,
            summary,
        } in editions
        {
            let mut cells = vec![
                year.clone(),
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
        report = if editions.len() > 1 {
            report.headed("editions", "THIS MEET IN EARLIER YEARS", history)
        } else {
            report.exported("editions", history)
        };
    }
    let mut notes = Vec::new();
    if !other_years.is_empty() {
        notes.push(format!(
            "Showing the {} edition. This meet name also has results in {}: pass --year to see one.",
            editions[0].year,
            other_years.join(", ")
        ));
    }
    if history && editions.len() == 1 {
        notes.push(format!(
            "No earlier editions of this meet found in the {EDITIONS} years before {}.",
            editions[0].year
        ));
    }
    if notes.is_empty() {
        report
    } else {
        report.titled(notes.join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::stats::tests::row;

    #[test]
    fn years_in_names_with_curly_quotes_accents_or_emoji_do_not_panic() {
        assert_eq!(year_in("KC Weightlifting’s Fall Open"), None);
        assert_eq!(year_in("Women’s Open"), None);
        assert_eq!(year_in("Motor City Summer Slam ‘25"), None);
        // The offset is in bytes and lands on the year, so slicing around it is safe.
        for (meet, year) in [
            ("Copa Atlético 2026", 2026),
            ("Low Key - Texas ⭐ State Qualifier 2025", 2025),
            ("Kākoʻo Weightlifting Invitational 2024", 2024),
        ] {
            let (index, found) = year_in(meet).unwrap();
            assert_eq!(found, year);
            assert_eq!(&meet[index..index + 4], year.to_string());
        }
        assert_eq!(year_in("The 2026 DMV WSO Championships"), Some((4, 2026)));
        assert_eq!(year_in("Summer Open"), None);
        assert_eq!(year_in("Meet 12345"), None);
    }

    #[test]
    fn earlier_editions_start_with_an_earlier_year_or_the_series_letter() {
        let prefixes = name_prefixes(&series_name("The 2026 DMV WSO Championships"), 2026);
        for prefix in ["2025", "The 2025", "2023", "The 2023", "The D", "D", "d"] {
            assert!(prefixes.iter().any(|p| p == prefix), "{prefix}");
        }
        assert!(!prefixes.iter().any(|p| p == "2026"));
        // A sponsor word leading an older edition's name is searched for too.
        let prefixes = name_prefixes(
            &series_name("2025 USA Weightlifting National Championships"),
            2025,
        );
        for prefix in ["Nike", "The Nike", "U", "2024"] {
            assert!(prefixes.iter().any(|p| p == prefix), "{prefix}");
        }
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

        let editions = [EditionSummary {
            meet: "M".into(),
            year: "2026".into(),
            summary,
        }];
        let json = report(&rows, &editions, &[], false).to_json();
        assert_eq!(json["heaviest_lifts"][2]["athlete"], "Ada");
        assert_eq!(json["top_sinclair_women"].as_array().unwrap().len(), 1);
        assert_eq!(json["top_sinclair_men"].as_array().unwrap().len(), 0);
        assert!(json.get("editions").is_none(), "--no-history leaves it out");

        // Asked for, the table is always exported, even with no earlier editions found.
        let with_history = report(&rows, &editions, &[], true);
        assert_eq!(with_history.to_json()["editions"][0]["meet"], "M");
        assert!(!with_history.to_text().contains("EARLIER YEARS"));
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
        let json = report(
            &rows,
            &[EditionSummary {
                meet: "M".into(),
                year: "2026".into(),
                summary,
            }],
            &[],
            false,
        )
        .to_json();
        assert_eq!(json["top_qpoints_men"][0]["athlete"], "Hampton");
        assert_eq!(json["top_qpoints_women"][0]["athlete"], "Olivia");
        assert_eq!(json["top_sinclair_men"].as_array().unwrap().len(), 1);
        assert_eq!(json["heaviest_lifts"][0]["athlete"], "Hampton");
        assert_eq!(json["heaviest_lifts"][2]["weight"], 315);
    }

    #[test]
    fn a_meet_held_every_year_under_one_name_shows_one_edition() {
        let lift = |name: &str, date: &str, total_snatch: f64| {
            row(
                name,
                date,
                "Testify Leprechaun Lift-off",
                "Open Men's 89kg",
                88.0,
                [total_snatch, 0.0, 0.0],
                [120.0, 0.0, 0.0],
            )
        };
        let mut years = editions_by_year(vec![
            lift("Colin Reis", "2023-03-11", 100.0),
            lift("Colin Reis", "2024-03-16", 105.0),
            lift("Ada", "2024-03-16", 90.0),
        ]);
        let latest = years.remove("2024").unwrap();
        let editions = vec![
            EditionSummary {
                meet: "Testify Leprechaun Lift-off".into(),
                year: "2024".into(),
                summary: summarize(&latest),
            },
            EditionSummary {
                meet: "Testify Leprechaun Lift-off".into(),
                year: "2023".into(),
                summary: summarize(&years["2023"]),
            },
        ];
        let report = report(&latest, &editions, &["2023".into()], true);
        let json = report.to_json();
        assert_eq!(json["summary"][0]["athletes"], 2);
        assert_eq!(json["results"].as_array().unwrap().len(), 2);
        assert_eq!(json["editions"][1]["year"], 2023);
        assert_eq!(json["editions"][1]["athletes"], 1);
        assert!(report.to_text().contains("also has results in 2023"));
    }
}
