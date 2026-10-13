use std::collections::BTreeMap;
use std::io::Write;

use anyhow::{Result, bail};
use clap::Parser;
use comfy_table::Table;
use serde::Deserialize;
use serde_json::json;
use tokio::task::JoinSet;

use crate::types::lifting_results::LiftingResults;
use crate::utils::backend::{queries, query};
use crate::utils::format::{date_range, us_date};
use crate::utils::meet_names::{editions_by_year, equivalent_meets};
use crate::utils::output::{self, Report};
use crate::utils::stats::fold;

/// Meets `meets:attendance` counts per call (its limit).
pub const ATTENDANCE_BATCH: usize = 8;
/// The most meets one run counts; more means the words are too broad.
pub const MAX_MATCHES: usize = 80;
/// Name ranges listed at once.
pub const CONCURRENCY: usize = 16;

/// Where the results meets' names are split to be listed side by side. They only balance the
/// work: the ranges between them cover every name.
const RANGE_BOUNDARIES: &[&str] = &[
    "2", "2013", "2016", "2018", "2020", "2021", "2022", "2023", "2024", "2025", "2026", "2027",
    "3", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R",
    "S", "Sp", "T", "The 2", "The 2020", "The 2023", "The 3", "U", "V", "W", "X", "a",
];

/// Show how many took part in a meet year after year. Its name can change between years, so give
/// the words it always has: every meet whose name contains all of them (ignoring the year, "The"
/// and punctuation) counts as an edition. Both registrations and results are counted, so a meet
/// whose results are not in yet still shows its entries.
///
/// Examples:
///   meetcal attendance ohio wso
///   meetcal attendance virus finals
///   meetcal attendance national championships --exclude junior --exclude youth --exclude masters
#[derive(Parser)]
#[command(name = "attendance")]
pub struct AttendanceArgs {
    /// Words every edition's name contains
    #[arg(required = true)]
    pub words: Vec<String>,

    /// Leave out meets whose name contains this text (repeatable)
    #[arg(long, short = 'x')]
    pub exclude: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct NamesPage {
    json: String,
    next: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MeetName {
    meet: String,
}

#[derive(Debug, Deserialize)]
struct Answer {
    json: String,
}

/// One edition's numbers (`meets:attendance`).
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Edition {
    pub meet: String,
    pub lifters: usize,
    pub registrations: usize,
    pub first_date: Option<String>,
    pub last_date: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub status: Option<String>,
}

impl Edition {
    /// The edition's year: from its results, else its meet dates, else its name.
    pub fn year(&self) -> Option<String> {
        self.first_date
            .as_deref()
            .or(self.start_date.as_deref())
            .and_then(|date| date.get(..4))
            .map(str::to_string)
            .or_else(|| year_in_name(&self.meet))
    }
}

fn year_in_name(meet: &str) -> Option<String> {
    meet.split(|c: char| !c.is_ascii_digit())
        .find(|part| part.len() == 4 && (1950..=2100).contains(&part.parse::<i32>().unwrap_or(0)))
        .map(str::to_string)
}

/// A meet name reduced for matching: lowercase words, without years, "the" or punctuation.
pub fn normalized(meet: &str) -> String {
    meet.chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .filter(|word| {
            *word != "the" && !(word.len() == 4 && word.chars().all(|c| c.is_ascii_digit()))
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Whether `meet` contains every one of `words` and none of `exclude`.
pub fn matches(meet: &str, words: &[String], exclude: &[String]) -> bool {
    let name = normalized(meet);
    words.iter().all(|word| {
        let word = normalized(word);
        word.is_empty() || name.contains(&word)
    }) && !exclude.iter().any(|text| {
        let text = normalized(text);
        !text.is_empty() && name.contains(&text)
    })
}

/// Every meet name of `source` after `from` and before `before` (both exclusive).
pub(crate) async fn list_range(
    source: &'static str,
    from: Option<String>,
    before: Option<String>,
) -> Result<Vec<String>> {
    let mut names = Vec::new();
    let mut after = from;
    loop {
        let mut args = json!({ "source": source, "after": after });
        if let Some(before) = &before {
            args["before"] = json!(before);
        }
        let page: NamesPage = query(queries::MEET_NAMES_PAGE, &args).await?;
        let meets: Vec<MeetName> = serde_json::from_str(&page.json)?;
        names.extend(meets.into_iter().map(|m| m.meet));
        match page.next {
            Some(next) => after = Some(next),
            None => return Ok(names),
        }
    }
}

/// Every meet name in the results and the registrations.
async fn all_meet_names() -> Result<Vec<String>> {
    // Each range starts just before its boundary: `after` is exclusive, so a name equal to the
    // boundary would be skipped by starting at the boundary itself.
    let mut ranges: Vec<(Option<String>, Option<String>)> = Vec::new();
    let mut start: Option<String> = None;
    for boundary in RANGE_BOUNDARIES {
        ranges.push((start.clone(), Some(boundary.to_string())));
        start = Some(just_before(boundary));
    }
    ranges.push((start, None));

    let mut names = Vec::new();
    let mut pending = ranges.into_iter();
    let mut tasks = JoinSet::new();
    let total = RANGE_BOUNDARIES.len() + 1;
    let mut done = 0;
    let show_progress = std::io::IsTerminal::is_terminal(&std::io::stderr());
    for (from, before) in pending.by_ref().take(CONCURRENCY) {
        tasks.spawn(list_range("results", from, before));
    }
    tasks.spawn(list_range("registrations", None, None));
    while let Some(result) = tasks.join_next().await {
        names.extend(result??);
        done += 1;
        if show_progress {
            eprint!("\rListing meets… {}/{}", done.min(total), total);
            let _ = std::io::stderr().flush();
        }
        if let Some((from, before)) = pending.next() {
            tasks.spawn(list_range("results", from, before));
        }
    }
    if show_progress {
        eprint!("\r\x1b[2K");
    }
    names.sort();
    names.dedup();
    Ok(names)
}

/// The greatest string sorting before `boundary` for our purposes: `boundary` with its last
/// character stepped back and a high character appended, so `after` it includes `boundary`.
pub(crate) fn just_before(boundary: &str) -> String {
    let mut chars: Vec<char> = boundary.chars().collect();
    let last = chars.pop().expect("boundaries are not empty");
    let previous = char::from_u32(last as u32 - 1).unwrap_or(last);
    chars.push(previous);
    let mut out: String = chars.into_iter().collect();
    out.push('\u{10FFFF}');
    out
}

pub async fn run(args: AttendanceArgs) -> Result<()> {
    let names = all_meet_names().await?;
    let matched: Vec<String> = names
        .into_iter()
        .filter(|meet| matches(meet, &args.words, &args.exclude))
        .collect();
    let search = args.words.join(" ");
    if matched.is_empty() {
        bail!("No meet names contain \"{search}\". Try fewer or shorter words.");
    }
    if matched.len() > MAX_MATCHES {
        bail!(
            "{} meets contain \"{search}\"; add words or --exclude to narrow it (at most {MAX_MATCHES}).",
            matched.len()
        );
    }

    let mut editions: Vec<Edition> = Vec::new();
    for batch in matched.chunks(ATTENDANCE_BATCH) {
        let answer: Answer = query(queries::MEET_ATTENDANCE, &json!({ "meets": batch })).await?;
        for edition in serde_json::from_str::<Vec<Edition>>(&answer.json)? {
            if edition.spans_years() {
                // A name used every year: `meets:attendance` counts every year's results as one
                // meet, so count each year from the results themselves.
                let rows: Vec<LiftingResults> =
                    query(queries::MEET_RESULTS, &json!({ "meet": edition.meet })).await?;
                editions.extend(split_by_year(&edition, rows));
            } else {
                editions.push(edition);
            }
        }
    }
    output::emit(report(&search, &editions));
    Ok(())
}

impl Edition {
    /// Whether the name's results come from more than one year, so it is several editions.
    fn spans_years(&self) -> bool {
        match (&self.first_date, &self.last_date) {
            (Some(first), Some(last)) => first.get(..4) != last.get(..4),
            _ => false,
        }
    }
}

/// `edition` (a meet name held in several years) as one edition per year of its results `rows`:
/// each year's distinct lifters and dates. Its registrations and meet dates, which MeetCal keeps
/// for one meet per name, go to the year of the meet's start date, else the latest.
pub fn split_by_year(edition: &Edition, rows: Vec<LiftingResults>) -> Vec<Edition> {
    let years = editions_by_year(rows);
    let registered_year = edition
        .start_date
        .as_deref()
        .and_then(|date| date.get(..4))
        .filter(|year| years.contains_key(*year))
        .or_else(|| years.keys().last().map(String::as_str))
        .map(str::to_string);
    years
        .iter()
        .map(|(year, rows)| {
            let lifters: std::collections::HashSet<String> =
                rows.iter().map(|row| fold(&row.name)).collect();
            let first_date = rows.iter().map(|row| row.date.clone()).min();
            let last_date = rows.iter().map(|row| row.date.clone()).max();
            let registered = registered_year.as_deref() == Some(year.as_str());
            Edition {
                meet: edition.meet.clone(),
                lifters: lifters.len(),
                registrations: if registered { edition.registrations } else { 0 },
                first_date,
                last_date,
                start_date: edition.start_date.clone().filter(|_| registered),
                end_date: edition.end_date.clone().filter(|_| registered),
                status: edition.status.clone().filter(|_| registered),
            }
        })
        .collect()
}

/// Editions with each registrations-only name folded into the results edition of the same
/// event: the same name in another case or punctuation, or a combined national-week
/// registration whose results are published under the separate championships
/// ([`equivalent_meets`]). Its registrations show in that edition's "Registered" column, and the
/// year counts the results. A registrations-only edition with no such twin stays as it is.
pub fn merge_registrations(editions: &[Edition]) -> Vec<Edition> {
    let mut merged: Vec<Edition> = editions
        .iter()
        .filter(|edition| edition.lifters > 0 || edition.registrations == 0)
        .cloned()
        .collect();
    for registration in editions
        .iter()
        .filter(|edition| edition.lifters == 0 && edition.registrations > 0)
    {
        let twin = merged.iter_mut().find(|results| {
            results.lifters > 0
                && results.year() == registration.year()
                && equivalent_meets(&registration.meet, &results.meet)
        });
        match twin {
            Some(results) => {
                results.registrations = results.registrations.max(registration.registrations);
                if results.start_date.is_none() {
                    results.start_date = registration.start_date.clone();
                    results.end_date = registration.end_date.clone();
                    results.status = registration.status.clone();
                }
            }
            None => merged.push(registration.clone()),
        }
    }
    merged
}

pub fn report(search: &str, editions: &[Edition]) -> Report {
    let editions = merge_registrations(editions);
    let mut sorted: Vec<&Edition> = editions.iter().collect();
    sorted.sort_by(|a, b| {
        a.year()
            .cmp(&b.year())
            .then_with(|| a.first_date.cmp(&b.first_date))
            .then_with(|| a.meet.cmp(&b.meet))
    });

    let mut meets = Table::new();
    meets.set_header(vec![
        "Year",
        "Meet",
        "Dates",
        "Registered",
        "Lifters With Results",
        "Status",
    ]);
    for edition in &sorted {
        let dates = match (
            &edition.first_date,
            &edition.last_date,
            &edition.start_date,
            &edition.end_date,
        ) {
            (Some(first), Some(last), _, _) => date_range(first, last),
            (_, _, Some(start), Some(end)) => date_range(start, end),
            _ => String::new(),
        };
        let status = match (edition.lifters > 0, edition.registrations > 0) {
            (true, _) => "Results in".to_string(),
            (false, true) => format!(
                "Registrations only{}",
                edition
                    .status
                    .as_deref()
                    .map(|status| format!(" ({status})"))
                    .unwrap_or_default()
            ),
            (false, false) => "No entries".to_string(),
        };
        meets.add_row(vec![
            edition.year().unwrap_or_default(),
            edition.meet.clone(),
            dates,
            count(edition.registrations),
            count(edition.lifters),
            status,
        ]);
    }

    // By year: an edition counts its lifters with results, or its registrations when it has no
    // results yet.
    let mut years: BTreeMap<String, (usize, usize, usize, bool)> = BTreeMap::new();
    for edition in &sorted {
        let entry = years
            .entry(edition.year().unwrap_or_else(|| "?".into()))
            .or_default();
        entry.0 += 1;
        entry.1 += edition.registrations;
        if edition.lifters > 0 {
            entry.2 += edition.lifters;
        } else {
            entry.2 += edition.registrations;
            entry.3 |= edition.registrations > 0;
        }
    }
    let mut by_year = Table::new();
    by_year.set_header(vec![
        "Year",
        "Meets",
        "Registered",
        "Athletes",
        "Change",
        "Counted From",
    ]);
    let mut previous: Option<usize> = None;
    for (year, (meets_count, registered, athletes, from_registrations)) in &years {
        let change = previous
            .filter(|previous| *previous > 0)
            .map(|previous| {
                let delta = *athletes as f64 - previous as f64;
                format!("{:+} ({:+.1}%)", delta, delta * 100.0 / previous as f64)
            })
            .unwrap_or_else(|| "N/A".into());
        by_year.add_row(vec![
            year.clone(),
            meets_count.to_string(),
            count(*registered),
            athletes.to_string(),
            change,
            if *from_registrations {
                "Registrations (results not in yet)".to_string()
            } else {
                "Results".to_string()
            },
        ]);
        previous = Some(*athletes);
    }

    let latest = sorted
        .last()
        .and_then(|e| e.first_date.clone().or(e.start_date.clone()));
    Report::new()
        .titled(format!(
            "ATTENDANCE — meets named like \"{search}\"{}",
            latest
                .map(|date| format!(" (latest {})", us_date(&date)))
                .unwrap_or_default()
        ))
        .headed("by_year", "BY YEAR", by_year)
        .headed("editions", "EDITIONS", meets)
}

/// A count, or a dash for none (registrations exist only for meets MeetCal tracked).
fn count(value: usize) -> String {
    if value == 0 {
        "—".into()
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn names_match_across_years_and_wording() {
        let wanted = words(&["ohio", "wso"]);
        assert!(matches("2026 Ohio WSO Championships", &wanted, &[]));
        assert!(matches("The 2023 Ohio WSO Championship", &wanted, &[]));
        assert!(!matches("2026 Ohio Open", &wanted, &[]));
        let nationals = words(&["national", "championships"]);
        let exclude = words(&["junior", "youth"]);
        assert!(matches(
            "2025 USA Weightlifting National Championships, Powered by Rogue",
            &nationals,
            &exclude
        ));
        assert!(!matches(
            "The 2025 National Junior Championships, Powered by Rogue",
            &nationals,
            &exclude
        ));
        assert_eq!(
            normalized("The 2026 DMV WSO Championships!"),
            "dmv wso championships"
        );
    }

    #[test]
    fn ranges_start_just_before_each_boundary() {
        let before = just_before("B");
        assert!(before.as_str() < "B");
        assert!(before.as_str() > "Azzzz");
        assert!(just_before("2020").as_str() < "2020");
        assert!(just_before("2020").as_str() > "2019 Zeta Meet");
    }

    fn edition(
        meet: &str,
        lifters: usize,
        registrations: usize,
        first: Option<&str>,
        start: Option<&str>,
    ) -> Edition {
        Edition {
            meet: meet.into(),
            lifters,
            registrations,
            first_date: first.map(str::to_string),
            last_date: first.map(str::to_string),
            start_date: start.map(str::to_string),
            end_date: start.map(str::to_string),
            status: Some("upcoming".into()),
        }
    }

    #[test]
    fn years_count_results_or_registrations_before_results() {
        let editions = vec![
            edition(
                "2024 Ohio WSO Championships",
                174,
                0,
                Some("2024-08-31"),
                None,
            ),
            edition(
                "2025 Ohio WSO Championships",
                144,
                150,
                Some("2025-08-17"),
                Some("2025-08-16"),
            ),
            edition(
                "2026 Ohio WSO Championships",
                0,
                160,
                None,
                Some("2026-10-10"),
            ),
        ];
        let json = report("ohio wso", &editions).to_json();
        let by_year = json["by_year"].as_array().unwrap();
        assert_eq!(by_year[0]["athletes"], 174);
        assert_eq!(by_year[1]["athletes"], 144);
        assert_eq!(by_year[2]["athletes"], 160);
        assert_eq!(by_year[1]["change"], "-30 (-17.2%)");
        assert_eq!(by_year[1]["counted_from"], "Results");
        assert_eq!(
            by_year[2]["counted_from"],
            "Registrations (results not in yet)"
        );
        let editions = json["editions"].as_array().unwrap();
        assert_eq!(editions[2]["status"], "Registrations only (upcoming)");
        assert_eq!(editions[0]["registered"], "—");
    }

    #[test]
    fn a_name_held_every_year_counts_each_year() {
        use crate::utils::stats::tests::row;
        let lift = |name: &str, date: &str| {
            row(
                name,
                date,
                "Testify Leprechaun Lift-off",
                "Open Men's 89kg",
                88.0,
                [100.0, 0.0, 0.0],
                [120.0, 0.0, 0.0],
            )
        };
        let merged = Edition {
            meet: "Testify Leprechaun Lift-off".into(),
            lifters: 3,
            registrations: 0,
            first_date: Some("2018-03-10".into()),
            last_date: Some("2024-03-16".into()),
            start_date: None,
            end_date: None,
            status: None,
        };
        assert!(merged.spans_years());
        let editions = split_by_year(
            &merged,
            vec![
                lift("Ada", "2018-03-10"),
                lift("Bo", "2018-03-10"),
                lift("Ada", "2024-03-16"),
                lift("ADA", "2024-03-17"),
            ],
        );
        assert_eq!(editions.len(), 2);
        assert_eq!(editions[0].year().as_deref(), Some("2018"));
        assert_eq!(editions[0].lifters, 2);
        assert_eq!(editions[1].lifters, 1);
        assert_eq!(editions[1].last_date.as_deref(), Some("2024-03-17"));
        let json = report("testify", &editions).to_json();
        assert_eq!(json["by_year"][1]["change"], "-1 (-50.0%)");
    }

    #[test]
    fn registrations_under_another_spelling_join_their_results() {
        let editions = vec![
            edition(
                "2026 VIRUS Weightlifting Series 1",
                0,
                1382,
                None,
                Some("2026-03-05"),
            ),
            edition(
                "2026 Virus Weightlifting Series 1",
                1291,
                0,
                Some("2026-03-05"),
                None,
            ),
            edition(
                "2026 Virus Weightlifting Series 2, Powered by Rogue Fitness",
                573,
                677,
                Some("2026-09-13"),
                Some("2026-09-13"),
            ),
            edition(
                "2026 Masters National Championships & National University Championships",
                0,
                1071,
                None,
                Some("2026-04-09"),
            ),
            edition(
                "The 2026 USA Weightlifting Masters National Championships Powered by Rogue Fitness",
                504,
                0,
                Some("2026-04-09"),
                None,
            ),
            edition(
                "2026 Ohio WSO Championships",
                0,
                160,
                None,
                Some("2026-10-10"),
            ),
        ];
        let json = report("virus", &editions).to_json();
        let by_year = json["by_year"].as_array().unwrap();
        assert_eq!(by_year[0]["meets"], 4);
        // 1291 + 573 + 504 with results, and 160 registered where no results exist yet.
        assert_eq!(by_year[0]["athletes"], 2528);
        let rows = json["editions"].as_array().unwrap();
        assert_eq!(rows.len(), 4);
        let series_1 = rows
            .iter()
            .find(|row| row["meet"] == "2026 Virus Weightlifting Series 1")
            .unwrap();
        assert_eq!(series_1["registered"], 1382);
        assert_eq!(series_1["status"], "Results in");
    }
}
