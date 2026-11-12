use std::collections::HashMap;

use anyhow::{Result, anyhow, bail};
use clap::Parser;
use comfy_table::Table;
use serde::Deserialize;
use tokio::task::JoinSet;

use crate::{
    types::lifting_results::LiftingResults,
    utils::{
        backend::{queries, query, query_each},
        format::{capitalized, display_body_weight},
        make_rate::make_rate_tables,
        meet_names::{SPONSOR_WORDS, editions_by_year, series_name},
        names::{MAX_NAME_PAGES, NameKind, just_before, meet_names_between, not_found},
        output::{self, Report},
        stats::{
            Division, Gender, Lift, QPOINTS_LABEL, SINCLAIR_LABEL, fold, number, percent, points,
            row_qpoints, row_sinclair, valid_lift, valid_total,
        },
    },
};

/// Earlier editions of a meet compared, at most.
pub(crate) const EDITIONS: i32 = 3;
/// Lifters in the top-Sinclair table.
pub(crate) const TOP_SINCLAIR: usize = 10;

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
    #[arg(value_parser = crate::utils::filters::parse_name)]
    pub name: String,

    /// The edition to show, by year, for a meet held under one name every year (default: the
    /// latest)
    #[arg(long, short = 'y', value_parser = crate::utils::filters::parse_year)]
    pub year: Option<i32>,

    /// Skip the comparison with the meet's previous editions (a few lookups)
    #[arg(long)]
    pub no_history: bool,
}

/// One edition of a meet and its headline numbers.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct EditionSummary {
    pub(crate) meet: String,
    pub(crate) year: String,
    pub(crate) summary: MeetSummary,
}

#[derive(Debug, Deserialize)]
struct ScoredAthlete {
    score: f64,
    name: String,
}

#[derive(Debug, Deserialize)]
struct BestByGender {
    men: Option<ScoredAthlete>,
    women: Option<ScoredAthlete>,
}

impl BestByGender {
    fn pair(self) -> [Option<(f64, String)>; 2] {
        [self.men, self.women].map(|best| best.map(|best| (best.score, best.name)))
    }
}

#[derive(Debug, Deserialize)]
struct EditionAnswer {
    meet: String,
    year: String,
    athletes: usize,
    bomb_outs: usize,
    average_total: Option<f64>,
    make_rate: Option<f64>,
    best_sinclair: BestByGender,
    best_qpoints: BestByGender,
}

impl From<EditionAnswer> for EditionSummary {
    fn from(answer: EditionAnswer) -> Self {
        EditionSummary {
            meet: answer.meet,
            year: answer.year,
            summary: MeetSummary {
                athletes: answer.athletes,
                bomb_outs: answer.bomb_outs,
                average_total: answer.average_total,
                make_rate: answer.make_rate,
                best_sinclair: answer.best_sinclair.pair(),
                best_qpoints: answer.best_qpoints.pair(),
            },
        }
    }
}

pub(crate) const SUMMARY_MEETS_PER_READ: usize = 4;

async fn edition_summaries(meets: &[String]) -> Result<Vec<EditionSummary>> {
    let reads = meets
        .chunks(SUMMARY_MEETS_PER_READ)
        .map(|batch| serde_json::json!({ "meets": batch }))
        .collect();
    Ok(
        query_each::<Vec<EditionAnswer>>(queries::MEET_SUMMARIES, reads)
            .await?
            .into_iter()
            .flatten()
            .map(EditionSummary::from)
            .collect(),
    )
}

pub async fn run(args: MeetResultsArgs) -> Result<()> {
    let name = args.name;
    let asked = [name.clone()];
    let (rows, own_editions) = tokio::try_join!(meet_rows(&name), edition_summaries(&asked))?;
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

    let own_editions: Vec<EditionSummary> = own_editions
        .into_iter()
        .map(|edition| EditionSummary {
            meet: name.clone(),
            ..edition
        })
        .collect();
    let this_edition = own_editions
        .iter()
        .find(|edition| edition.year == year)
        .cloned()
        .ok_or_else(|| {
            anyhow!(
                "MeetCal has no summary of the {year} edition of \"{name}\" yet; try again in a \
                 minute"
            )
        })?;
    let earlier = if args.no_history {
        Vec::new()
    } else {
        earlier_editions(&name, &year, own_editions).await?
    };

    output::emit(report(
        &results,
        &this_edition,
        &earlier,
        &other_years,
        !args.no_history,
    ));
    Ok(())
}

async fn meet_rows(meet: &str) -> Result<Vec<LiftingResults>> {
    query(queries::MEET_RESULTS, &serde_json::json!({ "meet": meet })).await
}

async fn earlier_editions(
    meet: &str,
    year: &str,
    own_editions: Vec<EditionSummary>,
) -> Result<Vec<EditionSummary>> {
    let Ok(current) = year.parse::<i32>() else {
        return Ok(Vec::new());
    };
    let wanted = |edition_year: &str| {
        edition_year
            .parse::<i32>()
            .is_ok_and(|y| (current - EDITIONS..current).contains(&y))
    };
    let candidates: Vec<String> = edition_names(meet, current)
        .await?
        .into_iter()
        .filter(|candidate| {
            year_in(candidate).is_none_or(|(_, y)| (current - EDITIONS..current).contains(&y))
        })
        .collect();
    let mut editions: Vec<EditionSummary> = own_editions
        .into_iter()
        .chain(edition_summaries(&candidates).await?)
        .filter(|edition| wanted(&edition.year))
        .collect();
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
        let capitalized = capitalized(sponsor);
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
pub(crate) fn year_in(meet: &str) -> Option<(usize, i32)> {
    let bytes = meet.as_bytes();
    let is_digit_at = |at: Option<usize>| {
        at.and_then(|at| bytes.get(at))
            .is_some_and(u8::is_ascii_digit)
    };
    bytes.windows(4).enumerate().find_map(|(i, candidate)| {
        let bounded = !is_digit_at(i.checked_sub(1)) && !is_digit_at(i.checked_add(4));
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
pub(crate) struct MeetSummary {
    pub(crate) athletes: usize,
    pub(crate) bomb_outs: usize,
    pub(crate) average_total: Option<f64>,
    pub(crate) make_rate: Option<f64>,
    /// The best Sinclair and Q-points score and who scored it, men's and women's apart: each
    /// gender has its own scale.
    pub(crate) best_sinclair: [Option<(f64, String)>; 2],
    pub(crate) best_qpoints: [Option<(f64, String)>; 2],
}

/// The genders scores are ranked within, in report order.
const GENDERS: [Gender; 2] = [Gender::Men, Gender::Women];

pub(crate) fn performances(rows: &[LiftingResults]) -> Vec<Vec<&LiftingResults>> {
    type Performance = (String, String, [u64; 7]);
    let mut in_first_seen_order: Vec<Performance> = Vec::new();
    let mut rows_of: HashMap<Performance, Vec<&LiftingResults>> = HashMap::new();
    for row in rows {
        let lifts = [
            row.body_weight,
            row.snatch1,
            row.snatch2,
            row.snatch3,
            row.cj1,
            row.cj2,
            row.cj3,
        ]
        .map(f64::to_bits);
        let key = (fold(&row.name), row.date.clone(), lifts);
        if !rows_of.contains_key(&key) {
            in_first_seen_order.push(key.clone());
        }
        rows_of.entry(key).or_default().push(row);
    }
    in_first_seen_order
        .iter()
        .filter_map(|performance| rows_of.remove(performance))
        .collect()
}

fn one_row_per_performance(rows: &[LiftingResults]) -> Vec<&LiftingResults> {
    performances(rows)
        .into_iter()
        .filter_map(|group| group.first().copied())
        .collect()
}

fn top_table(
    results: &[LiftingResults],
    score: fn(&LiftingResults) -> Option<f64>,
    label: &str,
    gender: Gender,
) -> Table {
    let mut ranked: Vec<(&LiftingResults, f64)> = performances(results)
        .into_iter()
        .filter_map(|group| {
            group
                .into_iter()
                .filter(|row| Division::parse(&row.age).gender == Some(gender))
                .filter_map(|row| score(row).map(|value| (row, value)))
                .reduce(|best, next| if next.1 > best.1 { next } else { best })
        })
        .collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
    let mut top = Table::new();
    top.set_header(vec!["Rank", "Athlete", "Division", "BW", "Total", label]);
    for (rank, (row, value)) in (1..).zip(ranked.into_iter().take(TOP_SINCLAIR)) {
        top.add_row(vec![
            rank.to_string(),
            row.name.clone(),
            row.age.clone(),
            display_body_weight(row.body_weight),
            number(row.total),
            format!("{value:.2}"),
        ]);
    }
    top
}

pub(crate) fn report(
    results: &[LiftingResults],
    this_edition: &EditionSummary,
    earlier: &[EditionSummary],
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
            display_body_weight(result.body_weight),
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

    let summary = &this_edition.summary;
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

    let (by_attempt, by_lift) = make_rate_tables(&one_row_per_performance(results));
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

    {
        let mut table = Table::new();
        table.set_header(vec![
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
        } in std::iter::once(this_edition).chain(earlier)
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
            table.add_row(cells);
        }
        report = if history && !earlier.is_empty() {
            report.headed("editions", "THIS MEET IN EARLIER YEARS", table)
        } else {
            report.exported("editions", table)
        };
    }
    let mut notes = Vec::new();
    if !other_years.is_empty() {
        notes.push(format!(
            "Showing the {} edition. This meet name also has results in {}: pass --year to see one.",
            this_edition.year,
            other_years.join(", ")
        ));
    }
    if history && earlier.is_empty() {
        notes.push(format!(
            "No earlier editions of this meet found in the {EDITIONS} years before {}.",
            this_edition.year
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

    fn summary_of(athletes: usize) -> MeetSummary {
        MeetSummary {
            athletes,
            bomb_outs: 1,
            average_total: Some(190.0),
            make_rate: Some(50.0),
            best_sinclair: [None, Some((300.5, "Ada".to_string()))],
            best_qpoints: [None, None],
        }
    }

    #[test]
    fn an_edition_summary_reads_the_servers_answer() {
        let answer: Vec<EditionAnswer> = serde_json::from_value(serde_json::json!([{
            "meet": "2024 DMV WSO Championships", "year": "2024", "athletes": 118,
            "bomb_outs": 3, "average_total": 151.4, "make_rate": null,
            "best_sinclair": {"men": {"score": 401.23, "name": "A Lifter"}, "women": null},
            "best_qpoints": {"men": null, "women": {"score": 98.4, "name": "B Lifter"}}
        }]))
        .unwrap();
        let edition = EditionSummary::from(answer.into_iter().next().unwrap());
        assert_eq!(edition.meet, "2024 DMV WSO Championships");
        assert_eq!(edition.year, "2024");
        assert_eq!(
            edition.summary,
            MeetSummary {
                athletes: 118,
                bomb_outs: 3,
                average_total: Some(151.4),
                make_rate: None,
                best_sinclair: [Some((401.23, "A Lifter".to_string())), None],
                best_qpoints: [None, Some((98.4, "B Lifter".to_string()))],
            }
        );
    }

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
        let summary = summary_of(2);
        let editions = [EditionSummary {
            meet: "M".into(),
            year: "2026".into(),
            summary,
        }];
        let json = report(&rows, &editions[0], &editions[1..], &[], false).to_json();
        assert_eq!(json["heaviest_lifts"][2]["athlete"], "Ada");
        assert_eq!(json["top_sinclair_women"].as_array().unwrap().len(), 1);
        assert_eq!(json["top_sinclair_men"].as_array().unwrap().len(), 0);
        assert_eq!(json["editions"].as_array().unwrap().len(), 1);
        assert_eq!(json["editions"][0]["year"], 2026);
        assert!(
            !report(&rows, &editions[0], &editions[1..], &[], false)
                .to_text()
                .contains("EARLIER YEARS")
        );

        // Asked for, the table is always exported, even with no earlier editions found.
        let with_history = report(&rows, &editions[0], &editions[1..], &[], true);
        assert_eq!(with_history.to_json()["editions"][0]["meet"], "M");
        assert!(!with_history.to_text().contains("EARLIER YEARS"));
    }

    #[test]
    fn a_result_without_a_recorded_body_weight_shows_a_dash() {
        let rows = vec![
            row(
                "Ada",
                "2026-01-01",
                "M",
                "Open Women's 64kg",
                0.0,
                [80.0, -85.0, 85.0],
                [100.0, 105.0, -110.0],
            ),
            row(
                "Bea",
                "2026-01-01",
                "M",
                "Open Women's 64kg",
                63.25,
                [70.0, 75.0, -80.0],
                [90.0, 95.0, -100.0],
            ),
        ];
        let edition = EditionSummary {
            meet: "M".into(),
            year: "2026".into(),
            summary: summary_of(2),
        };
        let report = report(&rows, &edition, &[], &[], false);
        let json = report.to_json();
        assert_eq!(json["results"][0]["name"], "Ada");
        assert_eq!(json["results"][0]["bw"], serde_json::Value::Null);
        assert_eq!(json["results"][1]["bw"], 63.25);
        assert!(report.to_text().contains("| —  "));
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
        let summary = summary_of(3);
        let json = report(
            &rows,
            &EditionSummary {
                meet: "M".into(),
                year: "2026".into(),
                summary,
            },
            &[],
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
    fn a_lifter_listed_in_two_divisions_counts_once() {
        let lift = |name: &str, division: &str, snatch: [f64; 3]| {
            row(
                name,
                "2026-03-01",
                "M",
                division,
                70.0,
                snatch,
                [100.0, -105.0, 0.0],
            )
        };
        let rows = vec![
            lift("Ada Lift", "Open Women's 71kg", [80.0, 0.0, 0.0]),
            lift(
                "Ada  Lift",
                "Women's Masters (40-44) 71kg",
                [80.0, 0.0, 0.0],
            ),
            lift("Bea", "Open Women's 71kg", [-70.0, -70.0, -70.0]),
            lift("Bea", "Women's 16-17 Age Group 71kg", [-70.0, -70.0, -70.0]),
            lift("Ada Lift", "Open Women's 71kg", [60.0, 0.0, 0.0]),
        ];
        let mut rows = rows;
        let mut same_lifts_on_another_day = lift("Ada Lift", "Open Women's 71kg", [60.0, 0.0, 0.0]);
        same_lifts_on_another_day.date = "2026-04-05".into();
        rows.push(same_lifts_on_another_day);
        let summary = summary_of(4);

        let editions = [EditionSummary {
            meet: "M".into(),
            year: "2026".into(),
            summary,
        }];
        let json = report(&rows, &editions[0], &editions[1..], &[], false).to_json();
        assert_eq!(json["results"].as_array().unwrap().len(), 6);
        assert_eq!(json["summary"][0]["make_rate"], 50);
        assert_eq!(json["make_rate"][0]["total_make_rate"], 50);
        let top = json["top_sinclair_women"].as_array().unwrap();
        let names: Vec<&str> = top.iter().filter_map(|r| r["athlete"].as_str()).collect();
        assert_eq!(names, ["Ada Lift", "Ada Lift", "Ada Lift"]);
        assert_eq!(top[0]["total"], 180);
        assert_eq!(top[1]["total"], 160);
        assert_eq!(top[2]["total"], 160);
        assert_eq!(json["top_qpoints_women"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn a_lifter_in_a_youth_and_an_open_division_is_ranked_under_the_one_that_scores() {
        let lift = |division: &str| {
            row(
                "Bea",
                "2026-03-01",
                "M",
                division,
                70.0,
                [70.0, 0.0, 0.0],
                [90.0, 0.0, 0.0],
            )
        };
        let rows = vec![
            lift("Women's 16-17 Age Group 71kg"),
            lift("Open Women's 71kg"),
        ];
        let editions = [EditionSummary {
            meet: "M".into(),
            year: "2026".into(),
            summary: summary_of(1),
        }];
        let json = report(&rows, &editions[0], &editions[1..], &[], false).to_json();
        let top = json["top_qpoints_women"].as_array().unwrap();
        assert_eq!(top.len(), 1);
        assert_eq!(top[0]["division"], "Open Women's 71kg");
        assert_eq!(json["top_sinclair_women"].as_array().unwrap().len(), 1);
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
        let editions = [
            EditionSummary {
                meet: "Testify Leprechaun Lift-off".into(),
                year: "2024".into(),
                summary: summary_of(2),
            },
            EditionSummary {
                meet: "Testify Leprechaun Lift-off".into(),
                year: "2023".into(),
                summary: summary_of(1),
            },
        ];
        let report = report(
            &latest,
            &editions[0],
            &editions[1..],
            &["2023".into()],
            true,
        );
        let json = report.to_json();
        assert_eq!(json["summary"][0]["athletes"], 2);
        assert_eq!(json["results"].as_array().unwrap().len(), 2);
        assert_eq!(json["editions"][1]["year"], 2023);
        assert_eq!(json["editions"][1]["athletes"], 1);
        assert!(report.to_text().contains("also has results in 2023"));
    }
}
