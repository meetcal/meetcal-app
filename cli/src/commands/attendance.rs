use std::collections::BTreeMap;
use std::io::Write;

use anyhow::{Result, bail};
use clap::Parser;
use comfy_table::Table;
use serde::Deserialize;
use serde_json::json;
use tokio::task::JoinSet;

use crate::utils::backend::{queries, query};
use crate::utils::format::{date_range, us_date};
use crate::utils::output::{self, Report};

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

async fn list_range(
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
fn just_before(boundary: &str) -> String {
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
        editions.extend(serde_json::from_str::<Vec<Edition>>(&answer.json)?);
    }
    output::emit(report(&search, &editions));
    Ok(())
}

pub fn report(search: &str, editions: &[Edition]) -> Report {
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
}
