//! `club-trends` and `wso-trends`: a club's or WSO's results year by year, and its top lifters.

use std::collections::{BTreeMap, HashMap, HashSet};

use anyhow::Result;
use clap::Parser;
use comfy_table::Table;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::commands::group_wrapped::{
    ClubMembership, distinct_names, filter_membership_results, get_club_memberships,
    get_wso_memberships,
};
use crate::types::lifting_results::LiftingResults;
use crate::utils::athletes::histories;
use crate::utils::backend::{queries, query_each};
use crate::utils::format::us_date;
use crate::utils::lifters::counted_key;
use crate::utils::meet_names::{equivalent_meets, year_of};
use crate::utils::names::{NameKind, not_found};
use crate::utils::output::{self, Report};
use crate::utils::stats::{
    Lift, SINCLAIR_LABEL, attempt_habits, fold, number, percent, points, pr_flags, row_qpoints,
    row_sinclair, valid_total,
};

/// Lifters in the all-time table.
pub(crate) const TOP_LIFTERS: usize = 15;

/// Show a club's results year by year: athletes, meets, make rate, weight lifted, best total, PRs
/// and medals; then its top lifters of all time. Counts results at meets where the athlete was
/// registered with the club.
#[derive(Parser)]
#[command(
    name = "club-trends",
    after_help = r#"Examples:
  meetcal club-trends "Texas Barbell Club""#
)]
pub struct ClubTrendsArgs {
    /// Exact club name (see `meetcal clubs`)
    #[arg(value_parser = crate::utils::filters::parse_name)]
    pub club: String,

    /// Skip medals (one lookup per meet)
    #[arg(long)]
    pub no_medals: bool,
}

/// Show a WSO's results year by year: athletes, meets, make rate, weight lifted, best total, PRs
/// and medals; then its top lifters of all time. Counts results at meets where the athlete was
/// registered with the WSO.
#[derive(Parser)]
#[command(
    name = "wso-trends",
    after_help = r#"Examples:
  meetcal wso-trends Florida"#
)]
pub struct WsoTrendsArgs {
    /// Exact WSO name (see `meetcal wsos`)
    #[arg(value_parser = crate::utils::filters::parse_name)]
    pub wso: String,

    /// Skip medals (one lookup per meet)
    #[arg(long)]
    pub no_medals: bool,
}

pub async fn run_club(args: ClubTrendsArgs) -> Result<()> {
    let memberships = get_club_memberships(&args.club).await?;
    if memberships.is_empty() {
        let message = format!("No meet registrations found for club \"{}\"", args.club);
        return Err(not_found(NameKind::Club, &args.club, message).await);
    }
    run(
        &format!("CLUB — {}", args.club),
        &memberships,
        !args.no_medals,
    )
    .await
}

pub async fn run_wso(args: WsoTrendsArgs) -> Result<()> {
    let memberships = get_wso_memberships(&args.wso).await?;
    if memberships.is_empty() {
        let message = format!("No meet registrations found for WSO \"{}\"", args.wso);
        return Err(not_found(NameKind::Wso, &args.wso, message).await);
    }
    run(
        &format!("WSO — {}", args.wso),
        &memberships,
        !args.no_medals,
    )
    .await
}

async fn run(title: &str, memberships: &[ClubMembership], with_medals: bool) -> Result<()> {
    let names = distinct_names(memberships);
    let by_name = histories(&names).await?;

    let mut pr_totals: HashSet<PrKey> = HashSet::new();
    let mut all_rows: Vec<LiftingResults> = Vec::new();
    for rows in by_name.values() {
        for mut sorted in rows_by_lifter(rows).into_values() {
            sorted.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.meet.cmp(&b.meet)));
            for (row, flags) in sorted.iter().zip(pr_flags(&sorted)) {
                if flags.total {
                    pr_totals.insert(pr_key(row));
                }
            }
        }
        all_rows.extend(rows.iter().cloned());
    }
    let group_rows = filter_membership_results(memberships, all_rows);

    let medals = if with_medals {
        Some(medals_by_year(memberships, &group_rows).await?)
    } else {
        None
    };

    output::emit(report(title, &group_rows, &pr_totals, medals.as_ref()));
    Ok(())
}

fn rows_by_lifter(rows: &[LiftingResults]) -> HashMap<String, Vec<&LiftingResults>> {
    let mut by_lifter: HashMap<String, Vec<&LiftingResults>> = HashMap::new();
    for row in rows {
        by_lifter.entry(counted_key(row)).or_default().push(row);
    }
    by_lifter
}

type PrKey = (String, String, String, String);

fn pr_key(row: &LiftingResults) -> PrKey {
    (
        fold(&row.name),
        fold(&row.meet),
        row.date.clone(),
        counted_key(row),
    )
}

#[derive(Debug, Deserialize)]
pub(crate) struct YearMedals {
    pub(crate) year: String,
    pub(crate) gold: usize,
    pub(crate) silver: usize,
    pub(crate) bronze: usize,
}

pub(crate) const MEDAL_MEMBERS_PER_READ: usize = 2_000;

async fn medals_by_year(
    memberships: &[ClubMembership],
    group_rows: &[LiftingResults],
) -> Result<BTreeMap<String, [usize; 3]>> {
    let registered = members_by_meet(memberships);
    let mut counted_years: Vec<Vec<String>> = Vec::new();
    let mut reads: Vec<Value> = Vec::new();
    for (spellings, years) in meet_editions(group_rows) {
        let mut members = members_at(&registered, &spellings);
        members.sort();
        members.dedup();
        for batch in members.chunks(MEDAL_MEMBERS_PER_READ) {
            counted_years.push(years.clone());
            reads.push(json!({ "meets": spellings, "members": batch }));
        }
    }
    let answers = query_each::<Vec<YearMedals>>(queries::GROUP_MEDALS, reads).await?;
    let mut medals: BTreeMap<String, [usize; 3]> = BTreeMap::new();
    for (years, answer) in counted_years.iter().zip(answers) {
        for won in answer.into_iter().filter(|won| years.contains(&won.year)) {
            let [gold, silver, bronze] = medals.entry(won.year).or_default();
            *gold += won.gold;
            *silver += won.silver;
            *bronze += won.bronze;
        }
    }
    Ok(medals)
}

pub(crate) fn members_by_meet(memberships: &[ClubMembership]) -> HashMap<&str, Vec<&str>> {
    let mut registered: HashMap<&str, Vec<&str>> = HashMap::new();
    for membership in memberships {
        registered
            .entry(membership.meet.as_str())
            .or_default()
            .push(membership.name.as_str());
    }
    registered
}

pub(crate) fn members_at(
    registered: &HashMap<&str, Vec<&str>>,
    spellings: &[String],
) -> Vec<String> {
    let mut meets: Vec<&&str> = registered
        .keys()
        .filter(|registration| {
            spellings
                .iter()
                .any(|meet| equivalent_meets(registration, meet))
        })
        .collect();
    meets.sort();
    meets
        .into_iter()
        .flat_map(|meet| registered[*meet].iter().map(|name| name.to_string()))
        .collect()
}

/// The meets the group's rows come from, one entry per meet whatever its case or spacing: every
/// raw spelling of its name, and the years the group lifted there. A meet name held every year is
/// a separate meet each year, and one meet's name can be spelled differently between years.
pub(crate) fn meet_editions(group_rows: &[LiftingResults]) -> Vec<(Vec<String>, Vec<String>)> {
    let mut meets: BTreeMap<String, (Vec<String>, Vec<String>)> = BTreeMap::new();
    for row in group_rows {
        let (spellings, years) = meets.entry(fold(&row.meet)).or_default();
        if !spellings.contains(&row.meet) {
            spellings.push(row.meet.clone());
        }
        let row_year = year_of(&row.date).to_string();
        if !years.contains(&row_year) {
            years.push(row_year);
        }
    }
    meets.into_values().collect()
}

/// An athlete's best-total row (none while every row is a source error), best Sinclair, results,
/// and first and latest dates.
type LifterEntry<'a> = (
    Option<&'a LiftingResults>,
    Option<f64>,
    usize,
    String,
    String,
);

pub(crate) fn report(
    title: &str,
    group_rows: &[LiftingResults],
    pr_totals: &HashSet<PrKey>,
    medals: Option<&BTreeMap<String, [usize; 3]>>,
) -> Report {
    let mut years: BTreeMap<String, Vec<&LiftingResults>> = BTreeMap::new();
    for row in group_rows {
        years
            .entry(year_of(&row.date).to_string())
            .or_default()
            .push(row);
    }

    let mut by_year = Table::new();
    let mut by_year_data = Table::new();
    let mut header = vec![
        "Year",
        "Athletes",
        "Meets",
        "Results",
        "Make Rate",
        "Total Lifted",
        "Best Total",
        "Total PRs",
    ];
    if medals.is_none() {
        by_year.set_header(header.clone());
    }
    header.extend(["Gold", "Silver", "Bronze"]);
    if medals.is_some() {
        by_year.set_header(header.clone());
    }
    by_year_data.set_header(header);
    for (year, rows) in &years {
        let athletes: HashSet<String> = rows.iter().map(|row| counted_key(row)).collect();
        let meets: HashSet<String> = rows.iter().map(|row| fold(&row.meet)).collect();
        let (mut taken, mut made) = (0, 0);
        for lift in [Lift::Snatch, Lift::CleanAndJerk] {
            let habits = attempt_habits(rows, lift);
            taken += habits.taken.iter().sum::<usize>();
            made += habits.made.iter().sum::<usize>();
        }
        let lifted: f64 = rows
            .iter()
            .map(|row| {
                [Lift::Snatch, Lift::CleanAndJerk]
                    .iter()
                    .flat_map(|lift| lift.attempts(row))
                    .filter(|attempt| *attempt > 0.0)
                    .sum::<f64>()
            })
            .sum();
        let best = rows
            .iter()
            .filter_map(|row| valid_total(row))
            .fold(0.0, f64::max);
        let prs = rows
            .iter()
            .filter(|row| pr_totals.contains(&pr_key(row)))
            .count();
        let mut cells = vec![
            year.clone(),
            athletes.len().to_string(),
            meets.len().to_string(),
            rows.len().to_string(),
            percent((taken > 0).then(|| made as f64 * 100.0 / taken as f64)),
            format!("{}kg", number(lifted)),
            number(best),
            prs.to_string(),
        ];
        match medals {
            Some(medals) => {
                let [gold, silver, bronze] = medals.get(year).copied().unwrap_or_default();
                cells.extend([gold.to_string(), silver.to_string(), bronze.to_string()]);
                by_year.add_row(cells.clone());
                by_year_data.add_row(cells);
            }
            None => {
                by_year.add_row(cells.clone());
                cells.extend([String::new(), String::new(), String::new()]);
                by_year_data.add_row(cells);
            }
        }
    }

    let mut best: HashMap<String, LifterEntry> = HashMap::new();
    for row in group_rows {
        let entry = best.entry(counted_key(row)).or_insert((
            None,
            None,
            0,
            row.date.clone(),
            row.date.clone(),
        ));
        // Source errors never count; of tied bests, the first, when it was set (rows arrive
        // newest first).
        if let Some(total) = valid_total(row)
            && entry.0.is_none_or(|kept| {
                total > kept.total || (total == kept.total && row.date < kept.date)
            })
        {
            entry.0 = Some(row);
        }
        if let Some(score) = row_sinclair(row) {
            entry.1 = Some(entry.1.map_or(score, |current: f64| current.max(score)));
        }
        entry.2 += 1;
        if row.date < entry.3 {
            entry.3 = row.date.clone();
        }
        if row.date > entry.4 {
            entry.4 = row.date.clone();
        }
    }
    let mut best_qpoints: HashMap<String, f64> = HashMap::new();
    for row in group_rows {
        if let Some(score) = row_qpoints(row) {
            let entry = best_qpoints.entry(counted_key(row)).or_insert(score);
            *entry = entry.max(score);
        }
    }
    let mut lifters: Vec<_> = best
        .into_values()
        .filter_map(|(row, sinclair, results, first, last)| {
            row.map(|row| (row, sinclair, results, first, last))
        })
        .collect();
    lifters.sort_by(|a, b| {
        b.0.total
            .total_cmp(&a.0.total)
            .then_with(|| a.0.name.cmp(&b.0.name))
    });
    let best_sinclair = format!("Best {SINCLAIR_LABEL}");
    let top_header = vec![
        "Rank",
        "Athlete",
        "Best Total",
        "Division",
        "Date",
        best_sinclair.as_str(),
        "Best Q-points",
        "Results",
        "First",
        "Latest",
    ];
    // Shown with US dates, exported with ISO ones.
    let mut top = Table::new();
    top.set_header(top_header.clone());
    let mut top_data = Table::new();
    top_data.set_header(top_header);
    for (rank, (row, sinclair, results, first, last)) in
        (1..).zip(lifters.into_iter().take(TOP_LIFTERS))
    {
        let cells = |date: String, first: String, last: String| {
            vec![
                rank.to_string(),
                row.name.clone(),
                number(row.total),
                row.age.clone(),
                date,
                points(sinclair),
                points(best_qpoints.get(&counted_key(row)).copied()),
                results.to_string(),
                first,
                last,
            ]
        };
        top.add_row(cells(us_date(&row.date), us_date(&first), us_date(&last)));
        top_data.add_row(cells(row.date.clone(), first, last));
    }

    Report::new()
        .titled(format!("TRENDS — {title}"))
        .headed_with_data("by_year", "BY YEAR", by_year, by_year_data)
        .headed_with_data("top_lifters", "TOP LIFTERS (ALL TIME)", top, top_data)
        .when_empty("No results found at meets where these athletes were registered.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::stats::tests::row;

    #[test]
    fn prs_are_judged_per_lifter_and_kept_apart_for_namesakes_at_one_meet() {
        let lifted = |lifter: &str, total: f64| {
            let mut result = row(
                "John Smith",
                "2026-03-01",
                "Meet",
                "Open Men's 89kg",
                88.0,
                [total * 0.45, 0.0, 0.0],
                [total * 0.55, 0.0, 0.0],
            );
            result.lifter_id = Some(lifter.to_owned());
            result
        };
        let rows = [lifted("L1", 300.0), lifted("L2", 250.0)];
        let groups = rows_by_lifter(&rows);
        assert_eq!(groups.len(), 2);
        assert_ne!(pr_key(&rows[0]), pr_key(&rows[1]));
        let mut marked = lifted("L1", 300.0);
        marked.lifter_id = None;
        marked.sole_lifter_id = Some("L1".to_owned());
        let mut unmarked = marked.clone();
        unmarked.sole_lifter_id = None;
        assert_ne!(pr_key(&marked), pr_key(&unmarked));
    }

    #[test]
    fn a_meets_members_are_those_registered_at_the_same_event() {
        let member = |name: &str, meet: &str| ClubMembership {
            name: name.into(),
            meet: meet.into(),
        };
        let combined = "2026 USA Weightlifting National Championships";
        let memberships = vec![
            member("Ada", "Ohio Open 2026"),
            member("Bea", "ohio open  2026"),
            member("Cy", "Another Meet"),
            member("Di", combined),
        ];
        let registered = members_by_meet(&memberships);
        let at = |meet: &str| members_at(&registered, &[meet.to_string()]);
        assert_eq!(at("Ohio Open 2026"), ["Ada", "Bea"]);
        assert_eq!(at("Another Meet"), ["Cy"]);
        assert_eq!(
            at("The 2026 National Junior Championships, Powered by Rogue Fitness"),
            ["Di"]
        );
        assert!(at("Some Other Meet").is_empty());
    }

    #[test]
    fn years_count_athletes_meets_prs_and_medals() {
        let rows = vec![
            row(
                "Ada",
                "2025-03-01",
                "M1",
                "Open Women's 64kg",
                63.0,
                [80.0, -85.0, 85.0],
                [100.0, 0.0, 0.0],
            ),
            row(
                "Bo",
                "2025-03-01",
                "M1",
                "Open Men's 89kg",
                88.0,
                [120.0, 0.0, 0.0],
                [150.0, 0.0, 0.0],
            ),
            row(
                "Ada",
                "2026-03-01",
                "M2",
                "Open Women's 64kg",
                63.0,
                [88.0, 0.0, 0.0],
                [106.0, 0.0, 0.0],
            ),
        ];
        let mut prs = HashSet::new();
        prs.insert(pr_key(&rows[2]));
        let mut medals = BTreeMap::new();
        medals.insert("2025".to_string(), [1, 0, 1]);
        let json = report("CLUB — Test", &rows, &prs, Some(&medals)).to_json();
        let by_year = json["by_year"].as_array().unwrap();
        assert_eq!(by_year[0]["year"], 2025);
        assert_eq!(by_year[0]["athletes"], 2);
        assert_eq!(by_year[0]["meets"], 1);
        assert_eq!(by_year[0]["gold"], 1);
        assert_eq!(by_year[0]["bronze"], 1);
        assert_eq!(by_year[1]["total_prs"], 1);
        assert_eq!(by_year[1]["total_lifted"], 194);
        let top = json["top_lifters"].as_array().unwrap();
        assert_eq!(top[0]["athlete"], "Bo");
        assert_eq!(top[1]["best_total"], 194);
        assert_eq!(top[1]["results"], 2);

        let without = report("CLUB — Test", &rows, &prs, None);
        let exported = without.to_json();
        let keys = |row: &serde_json::Value| -> Vec<String> {
            row.as_object().unwrap().keys().cloned().collect()
        };
        assert_eq!(keys(&exported["by_year"][0]), keys(&by_year[0]));
        assert_eq!(exported["by_year"][0]["gold"], serde_json::Value::Null);
        assert_eq!(exported["by_year"][0]["athletes"], 2);
        assert!(!without.to_text().contains("Gold"));
    }

    #[test]
    fn a_tied_best_total_is_dated_when_it_was_first_set() {
        let lift = |date: &str| {
            row(
                "Carter",
                date,
                date,
                "Open Men's 81kg",
                80.0,
                [93.0, 0.0, 0.0],
                [115.0, 0.0, 0.0],
            )
        };
        // Newest first, as `results:byNames` answers.
        let rows = vec![lift("2026-01-31"), lift("2025-03-08"), lift("2025-02-01")];
        let json = report("CLUB — Test", &rows, &HashSet::new(), None).to_json();
        assert_eq!(json["top_lifters"][0]["date"], "2025-02-01");
    }

    #[test]
    fn a_source_error_tops_no_table() {
        let real = row(
            "Ada",
            "2025-03-01",
            "M1",
            "Open Women's 64kg",
            63.0,
            [80.0, 0.0, 0.0],
            [100.0, 0.0, 0.0],
        );
        let mut shifted = row(
            "Bo",
            "2025-04-01",
            "M2",
            "Open Men's 89kg",
            88.0,
            [127.0, 0.0, 0.0],
            [135.0, 0.0, 0.0],
        );
        shifted.total = 820.0;
        let typo = row(
            "Cy",
            "2025-05-01",
            "M3",
            "Open Men's 89kg",
            88.0,
            [-63.0, 633.0, 65.0],
            [85.0, 90.0, -95.0],
        );
        let json = report("CLUB — Test", &[real, shifted, typo], &HashSet::new(), None).to_json();
        assert_eq!(json["by_year"][0]["best_total"], 180);
        let top = json["top_lifters"].as_array().unwrap();
        assert_eq!(top.len(), 1);
        assert_eq!(top[0]["athlete"], "Ada");
    }

    #[test]
    fn a_meet_spelled_differently_between_years_keeps_every_spelling() {
        let lift = |meet: &str, date: &str| {
            row(
                "Ada",
                date,
                meet,
                "Open Women's 64kg",
                63.0,
                [80.0, 0.0, 0.0],
                [100.0, 0.0, 0.0],
            )
        };
        let editions = meet_editions(&[
            lift("Spring Open", "2024-04-01"),
            lift("spring  open", "2025-04-01"),
            lift("Spring Open", "2024-04-01"),
            lift("Fall Open", "2025-10-01"),
        ]);
        assert_eq!(
            editions,
            [
                (vec!["Fall Open".to_string()], vec!["2025".to_string()]),
                (
                    vec!["Spring Open".to_string(), "spring  open".to_string()],
                    vec!["2024".to_string(), "2025".to_string()]
                ),
            ]
        );
    }
}
