use anyhow::{Result, bail};
use clap::{Parser, ValueEnum};
use comfy_table::Table;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::commands::leaderboard::MAX_YEARS;
use crate::commands::wrapped::current_year;
use crate::utils::backend::{functions, premium_action};
use crate::utils::filters::parse_date;
use crate::utils::format::us_date;
use crate::utils::names::{NameKind, not_found, registration_wsos};
use crate::utils::output::{self, Report};
use crate::utils::progress::Progress;
use crate::utils::stats::{fold, number, percent, points};

/// What an elite list ranks by.
#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Method {
    /// Total as a percentage of the A standard (Masters: the Senior A standard)
    #[value(name = "percent-a")]
    PercentA,
    /// Q-points (Overall: Masters by Q-masters, Youth left out)
    Qpoints,
    /// Q-points times the Masters age factor
    Qmasters,
    /// Sinclair (2021-24 coefficients)
    Sinclair,
}

impl Method {
    fn label(self) -> &'static str {
        match self {
            Method::PercentA => "% of A",
            Method::Qpoints => "Q-points",
            Method::Qmasters => "Q-masters",
            Method::Sinclair => "Sinclair",
        }
    }

    /// The score as the table shows it: a percentage to one decimal, points to two.
    fn score(self, value: f64) -> String {
        match self {
            Method::PercentA => percent(Some(value)),
            _ => points(Some(value)),
        }
    }
}

/// The lists, in the order they print, with what each may be scored by (its default first), as
/// the server's `ELITE_METHOD_CHOICES` (`convex/lib/elite.ts`).
pub const LISTS: [(&str, &str, &[Method]); 5] = [
    (
        "overall",
        "Overall",
        &[Method::PercentA, Method::Sinclair, Method::Qpoints],
    ),
    ("youth", "Youth", &[Method::PercentA, Method::Sinclair]),
    (
        "junior",
        "Junior",
        &[Method::PercentA, Method::Qpoints, Method::Sinclair],
    ),
    (
        "senior",
        "Senior",
        &[Method::PercentA, Method::Qpoints, Method::Sinclair],
    ),
    (
        "masters",
        "Masters",
        &[Method::Qmasters, Method::PercentA, Method::Sinclair],
    ),
];

/// A WSO's elite lists: its top 20 women and men Overall, Youth (17 and under), Junior (18-20),
/// Senior (21-34) and Masters (35 and over), each list ranked by its own score.
///
/// An athlete is the WSO's when their most recent meet registration names it; every USA
/// Weightlifting result of theirs in the range counts (adaptive included), at any meet. Their age
/// group is their weightlifting age in the result's year. Each athlete appears once per list, by
/// their best-scoring result.
///
/// Scores: --overall percent-a, sinclair or qpoints (default percent-a); --youth percent-a or
/// sinclair (default percent-a); --junior and --senior percent-a, qpoints or sinclair (default
/// percent-a); --masters qmasters, percent-a or sinclair (default qmasters). percent-a is the
/// total as a percentage of the A standard for the class the bodyweight falls in today (Youth
/// against Youth, Masters against Senior); Q-masters is Q-points times Huebner's 2025 age factor.
#[derive(Parser)]
#[command(
    name = "elite",
    after_help = r#"Examples:
  meetcal elite Carolina
  meetcal elite Carolina --year 2025 --masters percent-a
  meetcal elite Florida --from 2025-07-01 --to 2026-06-30 --overall sinclair"#
)]
pub struct EliteArgs {
    /// WSO, as registrations name it (see `meetcal wsos`)
    pub wso: String,

    /// Calendar year (defaults to last year; ignored with --from)
    #[arg(long, short = 'y', value_parser = clap::value_parser!(i32).range(1900..=9999))]
    pub year: Option<i32>,

    /// Start of the range, YYYY-MM-DD (with --to)
    #[arg(long, requires = "to", value_parser = parse_date)]
    pub from: Option<String>,

    /// End of the range, YYYY-MM-DD (with --from); less than five years after --from
    #[arg(long, requires = "from", value_parser = parse_date)]
    pub to: Option<String>,

    /// Overall list's score: percent-a, sinclair or qpoints
    #[arg(long, value_enum)]
    pub overall: Option<Method>,

    /// Youth list's score: percent-a or sinclair
    #[arg(long, value_enum)]
    pub youth: Option<Method>,

    /// Junior list's score: percent-a, qpoints or sinclair
    #[arg(long, value_enum)]
    pub junior: Option<Method>,

    /// Senior list's score: percent-a, qpoints or sinclair
    #[arg(long, value_enum)]
    pub senior: Option<Method>,

    /// Masters list's score: qmasters, percent-a or sinclair
    #[arg(long, value_enum)]
    pub masters: Option<Method>,
}

impl EliteArgs {
    /// The method asked for each list, in `LISTS` order.
    fn asked(&self) -> [Option<Method>; 5] {
        [
            self.overall,
            self.youth,
            self.junior,
            self.senior,
            self.masters,
        ]
    }
}

/// Each list's method: the one asked for, or the list's default; an error naming the choices for
/// a method a list does not offer.
pub fn methods(asked: [Option<Method>; 5]) -> Result<[Method; 5]> {
    let mut chosen = [Method::PercentA; 5];
    for (index, ((key, _, choices), asked)) in LISTS.iter().zip(asked).enumerate() {
        chosen[index] = match asked {
            Some(method) if choices.contains(&method) => method,
            Some(method) => {
                let names: Vec<String> = choices.iter().map(|m| value_name(*m)).collect();
                bail!(
                    "--{key} can be {}, not {}",
                    names.join(", "),
                    value_name(method)
                );
            }
            None => choices[0],
        };
    }
    Ok(chosen)
}

fn value_name(method: Method) -> String {
    method
        .to_possible_value()
        .map(|value| value.get_name().to_string())
        .unwrap_or_default()
}

/// The range: `--from`/`--to`, else `--year`, else last calendar year.
pub fn range(args: &EliteArgs) -> (String, String) {
    match (&args.from, &args.to) {
        (Some(from), Some(to)) => (from.clone(), to.clone()),
        _ => {
            let year = args.year.unwrap_or_else(|| current_year() - 1);
            (format!("{year:04}-01-01"), format!("{year:04}-12-31"))
        }
    }
}

/// `date` (`YYYY-MM-DD`) plus `years`, compared as text (the server's `plusYears`).
fn plus_years(date: &str, years: i32) -> String {
    let year: i32 = date.get(..4).and_then(|y| y.parse().ok()).unwrap_or(0);
    format!("{:04}{}", year + years, date.get(4..).unwrap_or(""))
}

/// One ranked result, as `results:wsoElite` answers it.
#[derive(Debug, Deserialize, PartialEq)]
pub struct EliteRow {
    pub name: String,
    pub date: String,
    pub meet: String,
    pub division: String,
    pub group: String,
    pub age: i64,
    pub body_weight: f64,
    pub snatch_best: f64,
    pub cj_best: f64,
    pub total: f64,
    pub score: f64,
    #[serde(default)]
    pub weight_class: Option<String>,
    #[serde(default)]
    pub standard_a: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct EliteList {
    pub method: Method,
    pub men: Vec<EliteRow>,
    pub women: Vec<EliteRow>,
}

#[derive(Debug, Deserialize)]
pub struct EliteLists {
    pub overall: EliteList,
    pub youth: EliteList,
    pub junior: EliteList,
    pub senior: EliteList,
    pub masters: EliteList,
}

impl EliteLists {
    fn in_order(&self) -> [&EliteList; 5] {
        [
            &self.overall,
            &self.youth,
            &self.junior,
            &self.senior,
            &self.masters,
        ]
    }
}

#[derive(Debug, Deserialize)]
pub struct EliteAnswer {
    pub members: i64,
    pub lists: EliteLists,
}

pub async fn run(args: EliteArgs) -> Result<()> {
    let methods = methods(args.asked())?;
    let (from, to) = range(&args);
    if to < from {
        bail!("--to must not be before --from");
    }
    if to >= plus_years(&from, MAX_YEARS) {
        bail!("Elite lists cover less than {MAX_YEARS} years: narrow --from and --to");
    }

    // The action matches the WSO as registrations spell it: take the spelling MeetCal knows.
    let wsos = registration_wsos().await?;
    let wso = wsos
        .iter()
        .find(|name| name.as_str() == args.wso.trim())
        .or_else(|| wsos.iter().find(|name| fold(name) == fold(&args.wso)))
        .cloned();
    let Some(wso) = wso else {
        let message = format!("No meet registrations found for WSO \"{}\"", args.wso);
        return Err(not_found(NameKind::Wso, &args.wso, message).await);
    };

    let mut method_args = serde_json::Map::new();
    for ((key, _, _), method) in LISTS.iter().zip(methods) {
        method_args.insert((*key).to_string(), json!(method));
    }
    let mut progress = Progress::new("Ranking the WSO's athletes on MeetCal");
    progress.update("");
    let answer: EliteAnswer = premium_action(
        functions::WSO_ELITE,
        &json!({ "wso": wso, "from": from, "to": to, "methods": method_args }),
    )
    .await?;
    drop(progress);

    let title = format!(
        "WSO ELITE — {wso}, {} to {} ({} athletes)",
        us_date(&from),
        us_date(&to),
        answer.members
    );
    output::emit(
        report(&answer.lists)
            .titled(title)
            .when_empty("No results for the WSO's athletes in that range."),
    );
    Ok(())
}

/// Ten tables: each list's women, then its men.
pub fn report(lists: &EliteLists) -> Report {
    let mut report = Report::new();
    for ((key, label, _), list) in LISTS.iter().zip(lists.in_order()) {
        for (gender, rows) in [("women", &list.women), ("men", &list.men)] {
            let heading = format!(
                "{} — {} ({})",
                label.to_uppercase(),
                gender.to_uppercase(),
                list.method.label()
            );
            report = report.headed_with_data(
                &format!("{key}_{gender}"),
                heading,
                table(rows, list.method, us_date),
                table(rows, list.method, str::to_string),
            );
        }
    }
    report
}

/// A list's rows, with dates written by `date` (US dates to show, ISO ones to export).
pub fn table(rows: &[EliteRow], method: Method, date: fn(&str) -> String) -> Table {
    let mut table = Table::new();
    table.set_header(vec![
        "Rank",
        "Athlete",
        "Age",
        "Group",
        "Division",
        "BW",
        "Snatch",
        "C&J",
        "Total",
        "Score",
        "Class",
        "A Standard",
        "Date",
        "Meet",
    ]);
    for (rank, row) in (1..).zip(rows) {
        table.add_row(vec![
            rank.to_string(),
            row.name.clone(),
            row.age.to_string(),
            capitalized(&row.group),
            row.division.clone(),
            number(row.body_weight),
            number(row.snatch_best),
            number(row.cj_best),
            number(row.total),
            method.score(row.score),
            row.weight_class.clone().unwrap_or_default(),
            row.standard_a.map(number).unwrap_or_default(),
            date(&row.date),
            row.meet.clone(),
        ]);
    }
    table
}

fn capitalized(value: &str) -> String {
    let mut chars = value.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_each_list_and_refuses_a_method_it_does_not_offer() {
        assert_eq!(
            methods([None; 5]).unwrap(),
            [
                Method::PercentA,
                Method::PercentA,
                Method::PercentA,
                Method::PercentA,
                Method::Qmasters
            ]
        );
        let chosen = methods([
            Some(Method::Qpoints),
            None,
            None,
            None,
            Some(Method::Sinclair),
        ]);
        assert_eq!(chosen.unwrap()[4], Method::Sinclair);
        let error = methods([None, Some(Method::Qpoints), None, None, None]).unwrap_err();
        assert_eq!(
            error.to_string(),
            "--youth can be percent-a, sinclair, not qpoints"
        );
        assert!(methods([None, None, None, Some(Method::Qmasters), None]).is_err());
    }

    #[test]
    fn sends_methods_as_the_server_names_them() {
        assert_eq!(json!(Method::PercentA), json!("percentA"));
        assert_eq!(json!(Method::Qmasters), json!("qmasters"));
    }

    fn row(name: &str, score: f64) -> EliteRow {
        EliteRow {
            name: name.into(),
            date: "2025-03-01".into(),
            meet: "Meet".into(),
            division: "Open Women's 63kg".into(),
            group: "senior".into(),
            age: 26,
            body_weight: 62.0,
            snatch_best: 90.0,
            cj_best: 110.0,
            total: 200.0,
            score,
            weight_class: Some("63kg".into()),
            standard_a: Some(200.0),
        }
    }

    #[test]
    fn exports_every_list_and_gender_with_fixed_columns() {
        let list = |method| EliteList {
            method,
            men: vec![],
            women: vec![row("Ada", 100.0)],
        };
        let lists = EliteLists {
            overall: list(Method::PercentA),
            youth: list(Method::PercentA),
            junior: list(Method::PercentA),
            senior: list(Method::PercentA),
            masters: list(Method::Qmasters),
        };
        let exported = report(&lists).to_json();
        let keys: Vec<&String> = exported.as_object().unwrap().keys().collect();
        assert_eq!(keys.len(), 10);
        assert_eq!(exported["overall_women"][0]["athlete"], "Ada");
        assert_eq!(exported["overall_women"][0]["score"], 100.0);
        assert_eq!(exported["overall_women"][0]["date"], "2025-03-01");
        assert_eq!(exported["masters_men"], json!([]));
        assert_eq!(exported["senior_women"][0]["class"], "63kg");
    }

    #[test]
    fn defaults_to_last_calendar_year() {
        let args = EliteArgs::parse_from(["elite", "Carolina"]);
        let last = current_year() - 1;
        assert_eq!(
            range(&args),
            (format!("{last}-01-01"), format!("{last}-12-31"))
        );
        let args = EliteArgs::parse_from(["elite", "Carolina", "--year", "2024"]);
        assert_eq!(range(&args), ("2024-01-01".into(), "2024-12-31".into()));
        let args = EliteArgs::parse_from([
            "elite",
            "Carolina",
            "--from",
            "2025-07-01",
            "--to",
            "2026-06-30",
        ]);
        assert_eq!(range(&args), ("2025-07-01".into(), "2026-06-30".into()));
    }
}
