//! `club-trends` and `wso-trends`: a club's or WSO's results year by year, and its top lifters.

use std::collections::{BTreeMap, HashMap, HashSet};

use anyhow::Result;
use clap::Parser;
use comfy_table::Table;
use serde_json::json;

use crate::commands::group_wrapped::{
    ClubMembership, distinct_names, filter_membership_results, get_club_memberships,
    get_wso_memberships,
};
use crate::commands::wso_results::calculate_medal_details;
use crate::types::lifting_results::LiftingResults;
use crate::types::wso::Movement;
use crate::utils::athletes::histories;
use crate::utils::backend::{queries, query};
use crate::utils::format::us_date;
use crate::utils::meet_names::{editions_by_year, equivalent_meets};
use crate::utils::names::{NameKind, not_found};
use crate::utils::output::{self, Report};
use crate::utils::stats::{
    Lift, SINCLAIR_LABEL, attempt_habits, fold, number, percent, points, pr_flags, row_qpoints,
    row_sinclair,
};

/// Lifters in the all-time table.
pub const TOP_LIFTERS: usize = 15;

/// Show a club's results year by year: athletes, meets, make rate, weight lifted, best total, PRs
/// and medals; then its top lifters of all time. Counts results at meets where the athlete was
/// registered with the club.
///
/// Examples:
///   meetcal club-trends "Texas Barbell Club"
#[derive(Parser)]
#[command(name = "club-trends")]
pub struct ClubTrendsArgs {
    /// Exact club name (see `meetcal clubs`)
    pub club: String,

    /// Skip medals (one lookup per meet)
    #[arg(long)]
    pub no_medals: bool,
}

/// Show a WSO's results year by year: athletes, meets, make rate, weight lifted, best total, PRs
/// and medals; then its top lifters of all time. Counts results at meets where the athlete was
/// registered with the WSO.
///
/// Examples:
///   meetcal wso-trends Florida
#[derive(Parser)]
#[command(name = "wso-trends")]
pub struct WsoTrendsArgs {
    /// Exact WSO name (see `meetcal wsos`)
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

    // PRs are judged against each athlete's whole history, not just the group's meets.
    let mut pr_totals: HashSet<(String, String, String)> = HashSet::new();
    let mut all_rows: Vec<LiftingResults> = Vec::new();
    for rows in by_name.values() {
        let mut sorted: Vec<&LiftingResults> = rows.iter().collect();
        sorted.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.meet.cmp(&b.meet)));
        for (row, flags) in sorted.iter().zip(pr_flags(&sorted)) {
            if flags.total {
                pr_totals.insert(pr_key(row));
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

fn pr_key(row: &LiftingResults) -> (String, String, String) {
    (fold(&row.name), fold(&row.meet), row.date.clone())
}

/// Gold, silver and bronze totals the group's athletes won, by year: placings by total within
/// each division at the meet.
async fn medals_by_year(
    memberships: &[ClubMembership],
    group_rows: &[LiftingResults],
) -> Result<BTreeMap<String, [usize; 3]>> {
    let mut medals: BTreeMap<String, [usize; 3]> = BTreeMap::new();
    for (spellings, years) in meet_editions(group_rows) {
        let members: Vec<String> = memberships
            .iter()
            .filter(|m| spellings.iter().any(|meet| equivalent_meets(&m.meet, meet)))
            .map(|m| m.name.clone())
            .collect();
        // Each spelling is a results meet already (the group's rows name it), so no aliases.
        // `results:byMeet` matches a name exactly, so each spelling is asked for. A meet also
        // answers the results titles linked to it: those spelled like it are the same meet and
        // kept, others are ranked when the group's rows name them. A title already read (as
        // another spelling's linked title) is not counted twice.
        let mut meet_rows: Vec<LiftingResults> = Vec::new();
        let mut titles: HashSet<String> = HashSet::new();
        for meet in &spellings {
            if titles.contains(meet) {
                continue;
            }
            let rows: Vec<LiftingResults> =
                query(queries::MEET_RESULTS, &json!({ "meet": meet })).await?;
            let fresh: Vec<LiftingResults> = own_title_rows(meet, rows)
                .into_iter()
                .filter(|row| !titles.contains(&row.meet))
                .collect();
            titles.extend(fresh.iter().map(|row| row.meet.clone()));
            meet_rows.extend(fresh);
        }
        let mut editions = editions_by_year(meet_rows);
        for meet_year in years {
            let Some(edition) = editions.remove(&meet_year) else {
                continue;
            };
            for detail in calculate_medal_details(&members, &edition) {
                if detail.movement == Movement::Total && (1..=3).contains(&detail.place) {
                    medals.entry(meet_year.clone()).or_default()[detail.place - 1] += 1;
                }
            }
        }
    }
    Ok(medals)
}

/// The meets the group's rows come from, one entry per meet whatever its case or spacing: every
/// raw spelling of its name, and the years the group lifted there. A meet name held every year is
/// a separate meet each year, and one meet's name can be spelled differently between years.
pub fn meet_editions(group_rows: &[LiftingResults]) -> Vec<(Vec<String>, Vec<String>)> {
    let mut meets: BTreeMap<String, (Vec<String>, Vec<String>)> = BTreeMap::new();
    for row in group_rows {
        let (spellings, years) = meets.entry(fold(&row.meet)).or_default();
        if !spellings.contains(&row.meet) {
            spellings.push(row.meet.clone());
        }
        let row_year = year(&row.date);
        if !years.contains(&row_year) {
            years.push(row_year);
        }
    }
    meets.into_values().collect()
}

/// The rows of `meet`'s own results title, leaving out the linked titles a
/// meet also answers (each is ranked when the group's rows name it).
fn own_title_rows(meet: &str, rows: Vec<LiftingResults>) -> Vec<LiftingResults> {
    rows.into_iter()
        .filter(|row| fold(&row.meet) == fold(meet))
        .collect()
}

fn year(date: &str) -> String {
    date.get(..4).unwrap_or(date).to_string()
}

pub fn report(
    title: &str,
    group_rows: &[LiftingResults],
    pr_totals: &HashSet<(String, String, String)>,
    medals: Option<&BTreeMap<String, [usize; 3]>>,
) -> Report {
    let mut years: BTreeMap<String, Vec<&LiftingResults>> = BTreeMap::new();
    for row in group_rows {
        years.entry(year(&row.date)).or_default().push(row);
    }

    let mut by_year = Table::new();
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
    if medals.is_some() {
        header.extend(["Gold", "Silver", "Bronze"]);
    }
    by_year.set_header(header);
    for (year, rows) in &years {
        let athletes: HashSet<String> = rows.iter().map(|row| fold(&row.name)).collect();
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
        let best = rows.iter().map(|row| row.total).fold(0.0, f64::max);
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
        if let Some(medals) = medals {
            let [gold, silver, bronze] = medals.get(year).copied().unwrap_or_default();
            cells.extend([gold.to_string(), silver.to_string(), bronze.to_string()]);
        }
        by_year.add_row(cells);
    }

    // Each athlete's best total with the group, and best Sinclair.
    let mut best: HashMap<String, (&LiftingResults, Option<f64>, usize, String, String)> =
        HashMap::new();
    for row in group_rows {
        let entry = best.entry(fold(&row.name)).or_insert((
            row,
            None,
            0,
            row.date.clone(),
            row.date.clone(),
        ));
        if row.total > entry.0.total {
            entry.0 = row;
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
            let entry = best_qpoints.entry(fold(&row.name)).or_insert(score);
            *entry = entry.max(score);
        }
    }
    let mut lifters: Vec<_> = best
        .into_values()
        .filter(|entry| entry.0.total > 0.0)
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
                points(best_qpoints.get(&fold(&row.name)).copied()),
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
        .headed("by_year", "BY YEAR", by_year)
        .headed_with_data("top_lifters", "TOP LIFTERS (ALL TIME)", top, top_data)
        .when_empty("No results found at meets where these athletes were registered.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::stats::tests::row;

    #[test]
    fn a_meet_is_ranked_on_its_own_title_not_its_linked_ones() {
        let lift = |name: &str, meet: &str| {
            row(
                name,
                "2026-06-20",
                meet,
                "Open Women's 64kg",
                63.0,
                [80.0, 0.0, 0.0],
                [100.0, 0.0, 0.0],
            )
        };
        let rows = vec![
            lift("Ann", "Nationals"),
            lift("Ada", "Junior"),
            lift("Bea", "nationals "),
        ];
        let names = own_title_rows("Nationals", rows)
            .into_iter()
            .map(|row| row.name)
            .collect::<Vec<_>>();
        assert_eq!(names, ["Ann", "Bea"]);
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
