use std::collections::HashMap;

use anyhow::{Result, bail};
use clap::{Parser, ValueEnum};
use comfy_table::Table;
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::commands::group_wrapped::{
    ClubMembership, distinct_names, filter_membership_results, get_club_memberships,
    get_recent_results, get_wso_memberships,
};
use crate::commands::wrapped::current_year;
use crate::types::lifting_results::LiftingResults;
use crate::utils::backend::{functions, premium_action};
use crate::utils::filters::{category, parse_date, unknown_federation};
use crate::utils::format::us_date;
use crate::utils::names::{NameKind, not_found};
use crate::utils::output::{self, Report};
use crate::utils::progress::Progress;
use crate::utils::stats::{
    Division, Gender, QPOINTS_LABEL, SINCLAIR_LABEL, fold, number, plausible, points, row_qpoints,
    row_sinclair,
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
        if !plausible(row) {
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

    /// The name `results:leaderboard` takes it by (its `by` argument).
    pub fn server_name(self) -> &'static str {
        match self {
            Metric::Total => "total",
            Metric::Snatch => "snatch",
            Metric::Cj => "cj",
            Metric::Sinclair => "sinclair",
            Metric::Qpoints => "qpoints",
        }
    }
}

/// The most rows a leaderboard shows (`results:leaderboard`'s limit).
pub const MAX_LIMIT: i64 = 500;

/// Rank athletes by their best total, snatch, clean & jerk, Sinclair or Q-points over a year or
/// date range,
/// across every class, filtered by gender, age category, division, federation, WSO or club.
///
/// Without --club or --wso, MeetCal ranks every athlete on its servers (a range of under five
/// years) and answers the top rows. Source errors are left out: totals that are not the snatch
/// plus clean & jerk, typo'd attempts (633 for 63) and lifts over the world records. Sinclair is
/// not computed for impossible bodyweights.
///
/// Sinclair and Q-points score men and women on separate scales, so --by sinclair and --by
/// qpoints need --gender. British Weightlifting (BWL) results are left out unless --federation
/// BWL asks for them.
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
    #[arg(long, requires = "to", value_parser = parse_date)]
    pub from: Option<String>,

    /// End of the range, YYYY-MM-DD (with --from); under five years after --from without --club
    /// or --wso
    #[arg(long, requires = "from", value_parser = parse_date)]
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

    /// Only this federation, e.g. USAW, USAMW or BWL (default: every federation but BWL)
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

    /// Rows to show, 1 to 500
    #[arg(long, short = 'n', default_value_t = 25, value_parser = clap::value_parser!(u16).range(1..=MAX_LIMIT))]
    pub limit: u16,
}

/// The range a year or --from/--to covers.
pub fn range(year: Option<i32>, from: Option<&str>, to: Option<&str>) -> (String, String) {
    match (from, to) {
        (Some(from), Some(to)) => (from.trim().to_string(), to.trim().to_string()),
        _ => {
            let year = year.unwrap_or_else(current_year);
            (format!("{year:04}-01-01"), format!("{year:04}-12-31"))
        }
    }
}

/// The filters rows must pass. `results:leaderboard` applies the same ones on the server
/// (`convex/lib/leaderboard.ts`); these rank a club's or WSO's rows.
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
            && self
                .gender
                .is_none_or(|gender| division.gender == Some(gender))
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
            && match self.federation.as_deref() {
                Some(federation) => row.federation.eq_ignore_ascii_case(federation.trim()),
                None => !row.federation.eq_ignore_ascii_case(EXCLUDED_FEDERATION),
            }
    }

    /// The filters as `results:leaderboard`'s arguments (absent ones left out).
    fn arguments(&self, fields: &mut Map<String, Value>) {
        if let Some(gender) = self.gender {
            fields.insert("gender".into(), gender.label().into());
        }
        for (name, value) in [
            ("category", &self.category),
            ("division", &self.division),
            ("federation", &self.federation),
        ] {
            if let Some(value) = value {
                fields.insert(name.into(), value.trim().into());
            }
        }
        if self.adaptive {
            fields.insert("adaptive".into(), true.into());
        }
    }
}

/// The federation left out unless asked for: British Weightlifting, outside USA comparisons (the
/// adaptive records and the server's club stats leave it out too).
pub const EXCLUDED_FEDERATION: &str = "BWL";

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

/// A ranked row as the table prints it: one of `results:leaderboard`'s rows, or a club's or WSO's
/// row ranked here.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct LeaderboardRow {
    pub name: String,
    pub date: String,
    pub meet: String,
    /// The division.
    pub age: String,
    pub federation: String,
    pub body_weight: f64,
    pub snatch_best: f64,
    pub cj_best: f64,
    pub total: f64,
    pub sinclair: Option<f64>,
    pub qpoints: Option<f64>,
    /// What the row was ranked by.
    pub value: f64,
}

impl LeaderboardRow {
    fn ranked(row: &LiftingResults, value: f64) -> Self {
        Self {
            name: row.name.clone(),
            date: row.date.clone(),
            meet: row.meet.clone(),
            age: row.age.clone(),
            federation: row.federation.clone(),
            body_weight: row.body_weight,
            snatch_best: row.snatch_best,
            cj_best: row.cj_best,
            total: row.total,
            sinclair: row_sinclair(row),
            qpoints: row_qpoints(row),
            value,
        }
    }
}

/// `results:leaderboard`'s answer: the ranked rows, and every federation in the range.
#[derive(Debug, Deserialize)]
pub struct LeaderboardAnswer {
    pub rows: Vec<LeaderboardRow>,
    pub federations: Vec<String>,
}

/// `results:leaderboard`'s arguments.
pub fn leaderboard_arguments(
    from: &str,
    to: &str,
    metric: Metric,
    filters: &Filters,
    limit: u16,
) -> Value {
    let mut fields = Map::new();
    fields.insert("from".into(), from.into());
    fields.insert("to".into(), to.into());
    fields.insert("by".into(), metric.server_name().into());
    filters.arguments(&mut fields);
    fields.insert("limit".into(), limit.into());
    Value::Object(fields)
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
    if gender.is_none() && matches!(args.by, Metric::Sinclair | Metric::Qpoints) {
        bail!(
            "Sinclair and Q-points score men and women on separate scales: add --gender men or --gender women"
        );
    }
    let filters = Filters {
        gender,
        category: args.category.as_deref().map(category).transpose()?,
        division: args.division.clone(),
        federation: args.federation.clone(),
        adaptive: args.adaptive,
    };

    let group = if let Some(club) = &args.club {
        let memberships = get_club_memberships(club).await?;
        if memberships.is_empty() {
            let message = format!("No meet registrations found for club \"{club}\"");
            return Err(not_found(NameKind::Club, club, message).await);
        }
        Some((format!("club {club}"), memberships))
    } else if let Some(wso) = &args.wso {
        let memberships = get_wso_memberships(wso).await?;
        if memberships.is_empty() {
            let message = format!("No meet registrations found for WSO \"{wso}\"");
            return Err(not_found(NameKind::Wso, wso, message).await);
        }
        Some((format!("WSO {wso}"), memberships))
    } else {
        None
    };
    let (scope, ranked, federations) = match group {
        Some((scope, memberships)) => {
            let rows = group_rows(&memberships, &from, &to).await?;
            let ranked: Vec<LeaderboardRow> =
                rank(&rows, args.by, &filters, usize::from(args.limit))
                    .into_iter()
                    .map(|(row, value)| LeaderboardRow::ranked(row, value))
                    .collect();
            let federations = rows.into_iter().map(|row| row.federation).collect();
            (scope, ranked, federations)
        }
        None => {
            let mut progress = Progress::new("Ranking results on MeetCal");
            progress.update("");
            let answer: LeaderboardAnswer = premium_action(
                functions::LEADERBOARD,
                &leaderboard_arguments(&from, &to, args.by, &filters, args.limit),
            )
            .await?;
            drop(progress);
            ("all athletes".to_string(), answer.rows, answer.federations)
        }
    };
    let scope = match &args.federation {
        Some(federation) => format!("{scope}, federation {}", federation.trim()),
        None => format!("{scope}, {EXCLUDED_FEDERATION} results left out"),
    };

    if let Some(error) = unknown_federation(
        args.federation.as_deref(),
        federations.iter().map(String::as_str),
    ) {
        return Err(error);
    }
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
        Report::new()
            .table_with_data(
                "leaderboard",
                table(&ranked, us_date),
                table(&ranked, str::to_string),
            )
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
    let names = distinct_names(memberships);
    let results = get_recent_results(&names, from).await?;
    Ok(filter_membership_results(memberships, results)
        .into_iter()
        .filter(|row| row.date.as_str() <= to)
        .collect())
}

/// The ranked rows, with dates written by `date` (US dates to show, ISO ones to export).
pub fn table(ranked: &[LeaderboardRow], date: fn(&str) -> String) -> Table {
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
    for (rank, row) in (1..).zip(ranked) {
        table.add_row(vec![
            rank.to_string(),
            row.name.clone(),
            row.age.clone(),
            number(row.body_weight),
            number(row.snatch_best),
            number(row.cj_best),
            number(row.total),
            points(row.sinclair),
            points(row.qpoints),
            date(&row.date),
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
    fn british_results_are_ranked_only_when_asked_for() {
        let mut rows = rows();
        let mut british = row(
            "Ramiro",
            "2025-06-01",
            "British Senior Championships 2025",
            "Men's Senior 110Kg",
            109.0,
            [170.0, 0.0, 0.0],
            [202.0, 0.0, 0.0],
        );
        british.federation = "BWL".into();
        rows.push(british);
        let names = |filters: &Filters| -> Vec<String> {
            rank(&rows, Metric::Total, filters, 10)
                .iter()
                .map(|(row, _)| row.name.clone())
                .collect()
        };
        assert!(!names(&Filters::default()).contains(&"Ramiro".to_string()));
        let bwl = Filters {
            federation: Some("bwl".into()),
            ..Filters::default()
        };
        assert_eq!(names(&bwl), ["Ramiro"]);
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

    #[test]
    fn the_server_gets_the_filters_given_and_no_others() {
        let filters = Filters {
            gender: Some(Gender::Women),
            category: Some("Masters 45".into()),
            federation: Some(" bwl ".into()),
            ..Filters::default()
        };
        assert_eq!(
            leaderboard_arguments("2025-01-01", "2025-12-31", Metric::Sinclair, &filters, 25),
            serde_json::json!({
                "from": "2025-01-01",
                "to": "2025-12-31",
                "by": "sinclair",
                "gender": "Women",
                "category": "Masters 45",
                "federation": "bwl",
                "limit": 25,
            })
        );
        let adaptive = Filters {
            adaptive: true,
            division: Some("89kg".into()),
            ..Filters::default()
        };
        assert_eq!(
            leaderboard_arguments("2025-01-01", "2025-12-31", Metric::Cj, &adaptive, 500),
            serde_json::json!({
                "from": "2025-01-01",
                "to": "2025-12-31",
                "by": "cj",
                "division": "89kg",
                "adaptive": true,
                "limit": 500,
            })
        );
    }

    #[test]
    fn reads_the_servers_rows_and_ranks_a_groups_rows_into_the_same_shape() {
        // Convex writes numbers as floats; a youth row has no Q-points.
        let answer: LeaderboardAnswer = serde_json::from_value(serde_json::json!({
            "rows": [{
                "name": "Bo", "date": "2026-02-01", "meet": "M1", "age": "Open Men's 89kg",
                "federation": "USAW", "body_weight": 88.0, "snatch_best": 140.0, "cj_best": 175.0,
                "total": 315.0, "sinclair": 382.5, "qpoints": null, "value": 315.0
            }],
            "federations": ["USAW", "USAMW"]
        }))
        .unwrap();
        assert_eq!(answer.rows[0].qpoints, None);
        assert_eq!(answer.federations, ["USAW", "USAMW"]);
        let rows = rows();
        let (row, value) = rank(&rows, Metric::Total, &Filters::default(), 1)[0];
        let ranked = LeaderboardRow::ranked(row, value);
        assert_eq!(ranked.name, "Bo");
        assert_eq!(ranked.value, 315.0);
        assert_eq!(ranked.sinclair, row_sinclair(row));
        assert_eq!(ranked.qpoints, row_qpoints(row));
    }
}
