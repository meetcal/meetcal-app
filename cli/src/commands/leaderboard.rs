use std::collections::HashMap;
use std::io::Write;

use anyhow::{Result, bail};
use chrono::{Datelike, Utc};
use clap::{Parser, ValueEnum};
use comfy_table::Table;

use crate::commands::group_wrapped::{
    ClubMembership, filter_membership_results, get_club_memberships, get_recent_results,
    get_wso_memberships,
};
use crate::types::lifting_results::LiftingResults;
use crate::utils::athletes::results_between;
use crate::utils::format::us_date;
use crate::utils::names::{NameKind, not_found};
use crate::utils::output::{self, Report};
use crate::utils::stats::{
    Division, Gender, QPOINTS_LABEL, SINCLAIR_LABEL, consistent_total, fold, number, points,
    row_qpoints, row_sinclair,
};

/// What a leaderboard ranks by.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, ValueEnum)]
pub enum Metric {
    #[default]
    Total,
    Snatch,
    Cj,
    Sinclair,
    /// Q-points (juniors, seniors and Masters; youth divisions have none)
    Qpoints,
}

impl Metric {
    fn value(self, row: &LiftingResults) -> Option<f64> {
        if !consistent_total(row) {
            return None;
        }
        let value = match self {
            Metric::Total => row.total,
            Metric::Snatch => row.snatch_best,
            Metric::Cj => row.cj_best,
            Metric::Sinclair => row_sinclair(row)?,
            Metric::Qpoints => row_qpoints(row)?,
        };
        (value > 0.0).then_some(value)
    }
}

/// Rank athletes by their best total, snatch, clean & jerk, Sinclair or Q-points over a year or
/// date range,
/// across every class, filtered by gender, age category, division, federation, WSO or club.
///
/// Without --club or --wso it reads every result in the range (a year is about 28,000). Results
/// whose total is not their snatch plus clean & jerk (a source error) are left out, and Sinclair
/// is not computed for impossible bodyweights.
///
/// Examples:
///   meetcal leaderboard --by sinclair --gender women
///   meetcal leaderboard --year 2025 --by snatch --category "Masters 45"
///   meetcal leaderboard --wso Florida --by total --limit 10
#[derive(Parser)]
#[command(name = "leaderboard")]
pub struct LeaderboardArgs {
    /// What to rank by
    #[arg(long, short = 'b', value_enum, default_value_t = Metric::Total)]
    pub by: Metric,

    /// Calendar year (defaults to the current year; ignored with --from)
    #[arg(long, short = 'y', value_parser = clap::value_parser!(i32).range(1900..=9999))]
    pub year: Option<i32>,

    /// Start of the range, YYYY-MM-DD (with --to)
    #[arg(long, requires = "to")]
    pub from: Option<String>,

    /// End of the range, YYYY-MM-DD (with --from)
    #[arg(long, requires = "from")]
    pub to: Option<String>,

    /// Men or Women
    #[arg(long, short = 'g')]
    pub gender: Option<String>,

    /// Age category: Senior, Junior, U17, U15, U13, U11, or Masters 35 … Masters 90
    #[arg(long, short = 'c')]
    pub category: Option<String>,

    /// Only divisions containing this text, e.g. "89kg" or "Masters (45-49)"
    #[arg(long, short = 'd')]
    pub division: Option<String>,

    /// Only this federation, e.g. USAW or USAMW
    #[arg(long, short = 'f')]
    pub federation: Option<String>,

    /// Only athletes registered with this WSO at the meet
    #[arg(long, short = 'w', conflicts_with = "club")]
    pub wso: Option<String>,

    /// Only athletes registered with this club at the meet
    #[arg(long)]
    pub club: Option<String>,

    /// Include adaptive results
    #[arg(long)]
    pub adaptive: bool,

    /// Rows to show
    #[arg(long, short = 'n', default_value_t = 25)]
    pub limit: usize,
}

/// The range a year or --from/--to covers.
pub fn range(year: Option<i32>, from: Option<&str>, to: Option<&str>) -> (String, String) {
    match (from, to) {
        (Some(from), Some(to)) => (from.trim().to_string(), to.trim().to_string()),
        _ => {
            let year = year.unwrap_or_else(|| Utc::now().year());
            (format!("{year:04}-01-01"), format!("{year:04}-12-31"))
        }
    }
}

/// The filters rows must pass.
#[derive(Debug, Default)]
pub struct Filters {
    pub gender: Option<Gender>,
    pub category: Option<String>,
    pub division: Option<String>,
    pub federation: Option<String>,
    pub adaptive: bool,
}

impl Filters {
    pub fn keeps(&self, row: &LiftingResults) -> bool {
        let division = Division::parse(&row.age);
        (self.adaptive || !row.adaptive)
            && self.gender.is_none_or(|gender| division.gender == gender)
            && self.category.as_deref().is_none_or(|wanted| {
                division
                    .category
                    .as_deref()
                    .is_some_and(|category| category.eq_ignore_ascii_case(wanted.trim()))
            })
            && self
                .division
                .as_deref()
                .is_none_or(|text| row.age.to_lowercase().contains(&text.trim().to_lowercase()))
            && self
                .federation
                .as_deref()
                .is_none_or(|federation| row.federation.eq_ignore_ascii_case(federation.trim()))
    }
}

/// Each athlete's best row by `metric` among `rows` that pass `filters`, best first (ties: the
/// earlier result), at most `limit`.
pub fn rank<'a>(
    rows: &'a [LiftingResults],
    metric: Metric,
    filters: &Filters,
    limit: usize,
) -> Vec<(&'a LiftingResults, f64)> {
    let mut best: HashMap<String, (&LiftingResults, f64)> = HashMap::new();
    for row in rows.iter().filter(|row| filters.keeps(row)) {
        let Some(value) = metric.value(row) else {
            continue;
        };
        best.entry(fold(&row.name))
            .and_modify(|current| {
                if value > current.1 || (value == current.1 && row.date < current.0.date) {
                    *current = (row, value);
                }
            })
            .or_insert((row, value));
    }
    let mut ranked: Vec<(&LiftingResults, f64)> = best.into_values().collect();
    ranked.sort_by(|a, b| {
        b.1.total_cmp(&a.1)
            .then_with(|| a.0.date.cmp(&b.0.date))
            .then_with(|| a.0.name.cmp(&b.0.name))
    });
    ranked.truncate(limit);
    ranked
}

pub async fn run(args: LeaderboardArgs) -> Result<()> {
    let (from, to) = range(args.year, args.from.as_deref(), args.to.as_deref());
    if to < from {
        bail!("--to must not be before --from");
    }
    let gender = match args.gender.as_deref() {
        Some(value) => match Gender::parse(value) {
            Some(gender) => Some(gender),
            None => bail!("Gender must be Men or Women, not \"{value}\""),
        },
        None => None,
    };
    let filters = Filters {
        gender,
        category: args.category.clone(),
        division: args.division.clone(),
        federation: args.federation.clone(),
        adaptive: args.adaptive,
    };

    let (scope, rows) = if let Some(club) = &args.club {
        let memberships = get_club_memberships(club).await?;
        if memberships.is_empty() {
            let message = format!("No meet registrations found for club \"{club}\"");
            return Err(not_found(NameKind::Club, club, message).await);
        }
        (
            format!("club {club}"),
            group_rows(&memberships, &from, &to).await?,
        )
    } else if let Some(wso) = &args.wso {
        let memberships = get_wso_memberships(wso).await?;
        if memberships.is_empty() {
            let message = format!("No meet registrations found for WSO \"{wso}\"");
            return Err(not_found(NameKind::Wso, wso, message).await);
        }
        (
            format!("WSO {wso}"),
            group_rows(&memberships, &from, &to).await?,
        )
    } else {
        let show_progress = std::io::IsTerminal::is_terminal(&std::io::stderr());
        let rows = results_between(&from, &to, |count| {
            if show_progress {
                eprint!("\rReading results… {count}");
                let _ = std::io::stderr().flush();
            }
        })
        .await?;
        if show_progress {
            eprint!("\r\x1b[2K");
        }
        ("all athletes".to_string(), rows)
    };

    let ranked = rank(&rows, args.by, &filters, args.limit);
    let metric = match args.by {
        Metric::Total => "total",
        Metric::Snatch => "snatch",
        Metric::Cj => "clean & jerk",
        Metric::Sinclair => "Sinclair (2021-24 coefficients)",
        Metric::Qpoints => "Q-points",
    };
    let title = format!(
        "LEADERBOARD — best {metric}, {} to {}, {scope}",
        us_date(&from),
        us_date(&to)
    );
    output::emit(
        Report::single("leaderboard", table(&ranked))
            .titled(title)
            .when_empty("No results match those filters."),
    );
    Ok(())
}

/// A group's members' results in the range, at meets where they registered with the group.
async fn group_rows(
    memberships: &[ClubMembership],
    from: &str,
    to: &str,
) -> Result<Vec<LiftingResults>> {
    let mut names: Vec<String> = Vec::new();
    for membership in memberships {
        if !names
            .iter()
            .any(|name| fold(name) == fold(&membership.name))
        {
            names.push(membership.name.clone());
        }
    }
    let results = get_recent_results(&names, from).await?;
    Ok(filter_membership_results(memberships, results)
        .into_iter()
        .filter(|row| row.date.as_str() <= to)
        .collect())
}

pub fn table(ranked: &[(&LiftingResults, f64)]) -> Table {
    let mut table = Table::new();
    table.set_header(vec![
        "Rank",
        "Athlete",
        "Division",
        "BW",
        "Snatch",
        "C&J",
        "Total",
        SINCLAIR_LABEL,
        QPOINTS_LABEL,
        "Date",
        "Meet",
    ]);
    for (rank, (row, _)) in (1..).zip(ranked) {
        table.add_row(vec![
            rank.to_string(),
            row.name.clone(),
            row.age.clone(),
            number(row.body_weight),
            number(row.snatch_best),
            number(row.cj_best),
            number(row.total),
            points(row_sinclair(row)),
            points(row_qpoints(row)),
            us_date(&row.date),
            row.meet.clone(),
        ]);
    }
    table
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::stats::tests::row;

    fn rows() -> Vec<LiftingResults> {
        vec![
            row(
                "Ada",
                "2026-01-01",
                "M1",
                "Open Women's 64kg",
                63.0,
                [85.0, 0.0, 0.0],
                [105.0, 0.0, 0.0],
            ),
            row(
                "Ada",
                "2026-05-01",
                "M2",
                "Open Women's 64kg",
                63.0,
                [88.0, 0.0, 0.0],
                [108.0, 0.0, 0.0],
            ),
            row(
                "Bo",
                "2026-02-01",
                "M1",
                "Open Men's 89kg",
                88.0,
                [140.0, 0.0, 0.0],
                [175.0, 0.0, 0.0],
            ),
            row(
                "Cy",
                "2026-03-01",
                "M1",
                "Women's Masters (45-49) 71kg",
                70.0,
                [60.0, 0.0, 0.0],
                [75.0, 0.0, 0.0],
            ),
        ]
    }

    #[test]
    fn ranks_each_athlete_once_by_their_best() {
        let rows = rows();
        let ranked = rank(&rows, Metric::Total, &Filters::default(), 10);
        let names: Vec<&str> = ranked.iter().map(|(r, _)| r.name.as_str()).collect();
        assert_eq!(names, ["Bo", "Ada", "Cy"]);
        assert_eq!(ranked[1].0.date, "2026-05-01");
    }

    #[test]
    fn filters_by_gender_category_and_division() {
        let rows = rows();
        let women = Filters {
            gender: Some(Gender::Women),
            ..Filters::default()
        };
        assert_eq!(rank(&rows, Metric::Snatch, &women, 10).len(), 2);
        let masters = Filters {
            category: Some("masters 45".into()),
            ..Filters::default()
        };
        assert_eq!(rank(&rows, Metric::Total, &masters, 10)[0].0.name, "Cy");
        let class = Filters {
            division: Some("89kg".into()),
            ..Filters::default()
        };
        assert_eq!(rank(&rows, Metric::Total, &class, 10)[0].0.name, "Bo");
    }

    #[test]
    fn sinclair_can_reorder_a_leaderboard() {
        let rows = rows();
        let ranked = rank(&rows, Metric::Sinclair, &Filters::default(), 1);
        assert_eq!(ranked.len(), 1);
        assert_eq!(ranked[0].0.name, "Bo");
    }

    #[test]
    fn qpoints_rank_juniors_seniors_and_masters() {
        let mut rows = rows();
        rows.push(row(
            "Yu",
            "2026-04-01",
            "M1",
            "Men's 16-17 Age Group 81kg",
            80.0,
            [150.0, 0.0, 0.0],
            [190.0, 0.0, 0.0],
        ));
        let ranked = rank(&rows, Metric::Qpoints, &Filters::default(), 10);
        let names: Vec<&str> = ranked.iter().map(|(r, _)| r.name.as_str()).collect();
        assert!(!names.contains(&"Yu"), "youth divisions have no Q-points");
        assert_eq!(names.len(), 3);
    }

    #[test]
    fn range_defaults_to_a_year() {
        assert_eq!(
            range(Some(2025), None, None),
            ("2025-01-01".into(), "2025-12-31".into())
        );
        assert_eq!(
            range(Some(2025), Some("2024-06-01"), Some("2024-06-30")),
            ("2024-06-01".into(), "2024-06-30".into())
        );
    }
}
