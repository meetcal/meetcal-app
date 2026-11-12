use anyhow::{Result, bail};
use clap::{Parser, ValueEnum};
use comfy_table::Table;
use serde::Deserialize;
use serde_json::json;

use crate::commands::leaderboard::MAX_YEARS;
use crate::utils::backend::{functions, premium_action};
use crate::utils::filters::{parse_date, plus_years};
use crate::utils::format::{capitalized, display_body_weight, display_weight_class, us_date};
use crate::utils::names::{NameKind, not_found, registration_wsos};
use crate::utils::output::{self, Report};
use crate::utils::progress::Progress;
use crate::utils::stats::{SINCLAIR_WITH_COEFFICIENTS, fold, number, percent, points};

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum Method {
    /// Total as a percentage of the A standard (Masters: the Senior A standard)
    #[value(name = "percent-a")]
    PercentA,
    /// Q-points (Overall: Masters by Q-masters, Youth left out)
    Qpoints,
    /// Q-points times the Masters age factor
    Qmasters,
    #[value(help = SINCLAIR_WITH_COEFFICIENTS)]
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

    fn server_name(self) -> &'static str {
        match self {
            Method::PercentA => "percentA",
            Method::Qpoints => "qpoints",
            Method::Qmasters => "qmasters",
            Method::Sinclair => "sinclair",
        }
    }

    fn score(self, value: f64) -> String {
        match self {
            Method::PercentA => percent(Some(value)),
            Method::Qpoints | Method::Qmasters | Method::Sinclair => points(Some(value)),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EliteList {
    Overall,
    Youth,
    Junior,
    Senior,
    Masters,
}

impl EliteList {
    const IN_REPORT_ORDER: [Self; 5] = [
        Self::Overall,
        Self::Youth,
        Self::Junior,
        Self::Senior,
        Self::Masters,
    ];

    fn key(self) -> &'static str {
        match self {
            Self::Overall => "overall",
            Self::Youth => "youth",
            Self::Junior => "junior",
            Self::Senior => "senior",
            Self::Masters => "masters",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Overall => "Overall",
            Self::Youth => "Youth",
            Self::Junior => "Junior",
            Self::Senior => "Senior",
            Self::Masters => "Masters",
        }
    }

    fn default_method(self) -> Method {
        match self {
            Self::Overall | Self::Youth | Self::Junior | Self::Senior => Method::PercentA,
            Self::Masters => Method::Qmasters,
        }
    }

    fn alternatives(self) -> &'static [Method] {
        match self {
            Self::Overall => &[Method::Sinclair, Method::Qpoints],
            Self::Youth => &[Method::Sinclair],
            Self::Junior | Self::Senior => &[Method::Qpoints, Method::Sinclair],
            Self::Masters => &[Method::PercentA, Method::Sinclair],
        }
    }

    fn offered(self) -> impl Iterator<Item = Method> {
        std::iter::once(self.default_method()).chain(self.alternatives().iter().copied())
    }
}

/// A WSO's elite lists: its top 20 women and men Overall, Youth (17 and under), Junior (18-20),
/// Senior (21-34) and Masters (35 and over), each list ranked by its own score.
///
/// An athlete is the WSO's when their most recent meet registration that names a WSO names it; every USA
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
    #[arg(value_parser = crate::utils::filters::parse_name)]
    pub wso: String,

    /// Calendar year (defaults to the current year, as leaderboard's; ignored with --from)
    #[arg(long, short = 'y', value_parser = crate::utils::filters::parse_year)]
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
    fn asked(&self, list: EliteList) -> Option<Method> {
        match list {
            EliteList::Overall => self.overall,
            EliteList::Youth => self.youth,
            EliteList::Junior => self.junior,
            EliteList::Senior => self.senior,
            EliteList::Masters => self.masters,
        }
    }
}

pub(crate) type ChosenMethods = Vec<(EliteList, Method)>;

pub(crate) fn methods(asked: impl Fn(EliteList) -> Option<Method>) -> Result<ChosenMethods> {
    EliteList::IN_REPORT_ORDER
        .into_iter()
        .map(|list| match asked(list) {
            Some(method) if list.offered().any(|offered| offered == method) => Ok((list, method)),
            Some(method) => {
                let names: Vec<String> = list.offered().map(value_name).collect();
                bail!(
                    "--{} can be {}, not {}",
                    list.key(),
                    names.join(", "),
                    value_name(method)
                );
            }
            None => Ok((list, list.default_method())),
        })
        .collect()
}

fn value_name(method: Method) -> String {
    method
        .to_possible_value()
        .map(|value| value.get_name().to_string())
        .unwrap_or_default()
}

pub(crate) fn range(args: &EliteArgs) -> (String, String) {
    crate::commands::leaderboard::range(args.year, args.from.as_deref(), args.to.as_deref())
}

/// One ranked result, as `results:wsoElite` answers it.
#[derive(Debug, Deserialize, PartialEq)]
pub(crate) struct EliteRow {
    pub(crate) name: String,
    pub(crate) date: String,
    pub(crate) meet: String,
    pub(crate) division: String,
    pub(crate) group: String,
    pub(crate) age: i64,
    pub(crate) body_weight: f64,
    pub(crate) snatch_best: f64,
    pub(crate) cj_best: f64,
    pub(crate) total: f64,
    pub(crate) score: f64,
    #[serde(default)]
    pub(crate) weight_class: Option<String>,
    #[serde(default)]
    pub(crate) standard_a: Option<f64>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct EliteRanking {
    pub(crate) men: Vec<EliteRow>,
    pub(crate) women: Vec<EliteRow>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct EliteLists {
    pub(crate) overall: EliteRanking,
    pub(crate) youth: EliteRanking,
    pub(crate) junior: EliteRanking,
    pub(crate) senior: EliteRanking,
    pub(crate) masters: EliteRanking,
}

impl EliteLists {
    fn of(&self, list: EliteList) -> &EliteRanking {
        match list {
            EliteList::Overall => &self.overall,
            EliteList::Youth => &self.youth,
            EliteList::Junior => &self.junior,
            EliteList::Senior => &self.senior,
            EliteList::Masters => &self.masters,
        }
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct EliteAnswer {
    pub(crate) members: i64,
    pub(crate) lists: EliteLists,
}

pub async fn run(args: EliteArgs) -> Result<()> {
    let methods = methods(|list| args.asked(list))?;
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
        .find(|name| name.as_str() == args.wso)
        .or_else(|| wsos.iter().find(|name| fold(name) == fold(&args.wso)))
        .cloned();
    let Some(wso) = wso else {
        let message = format!("No meet registrations found for WSO \"{}\"", args.wso);
        return Err(not_found(NameKind::Wso, &args.wso, message).await);
    };

    let mut method_args = serde_json::Map::new();
    for (list, method) in &methods {
        method_args.insert(list.key().to_string(), json!(method.server_name()));
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
        report(&answer.lists, &methods)
            .titled(title)
            .when_empty("No results for the WSO's athletes in that range."),
    );
    Ok(())
}

pub(crate) fn report(lists: &EliteLists, methods: &[(EliteList, Method)]) -> Report {
    let mut report = Report::new();
    for &(list, method) in methods {
        let ranking = lists.of(list);
        for (gender, rows) in [("women", &ranking.women), ("men", &ranking.men)] {
            let heading = format!(
                "{} — {} ({})",
                list.label().to_uppercase(),
                gender.to_uppercase(),
                method.label()
            );
            report = report.headed_with_data(
                &format!("{}_{gender}", list.key()),
                heading,
                table(rows, method, us_date),
                table(rows, method, str::to_string),
            );
        }
    }
    report
}

/// A list's rows, with dates written by `date` (US dates to show, ISO ones to export).
pub(crate) fn table(rows: &[EliteRow], method: Method, date: fn(&str) -> String) -> Table {
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
            display_body_weight(row.body_weight),
            number(row.snatch_best),
            number(row.cj_best),
            number(row.total),
            method.score(row.score),
            row.weight_class
                .as_deref()
                .map(display_weight_class)
                .unwrap_or_default(),
            row.standard_a.map(number).unwrap_or_default(),
            date(&row.date),
            row.meet.clone(),
        ]);
    }
    table
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::commands::wrapped::current_year;

    #[test]
    fn defaults_each_list_and_refuses_a_method_it_does_not_offer() {
        let asked = |args: &[&str]| {
            let args = EliteArgs::parse_from([&["elite", "Carolina"], args].concat());
            methods(|list| args.asked(list))
        };
        assert_eq!(
            asked(&[]).unwrap(),
            [
                (EliteList::Overall, Method::PercentA),
                (EliteList::Youth, Method::PercentA),
                (EliteList::Junior, Method::PercentA),
                (EliteList::Senior, Method::PercentA),
                (EliteList::Masters, Method::Qmasters),
            ]
        );
        assert_eq!(asked(&[]).unwrap(), default_methods());
        let chosen = asked(&["--overall", "qpoints", "--masters", "sinclair"]).unwrap();
        assert_eq!(chosen[0], (EliteList::Overall, Method::Qpoints));
        assert_eq!(chosen[4], (EliteList::Masters, Method::Sinclair));
        let error = asked(&["--youth", "qpoints"]).unwrap_err();
        assert_eq!(
            error.to_string(),
            "--youth can be percent-a, sinclair, not qpoints"
        );
        assert!(asked(&["--senior", "qmasters"]).is_err());
    }

    #[test]
    fn each_lists_methods_and_default_are_the_servers() {
        let server = include_str!("../../../convex/lib/elite.ts");
        let choices = server
            .split_once("export const ELITE_METHOD_CHOICES")
            .and_then(|(_, rest)| rest.split_once("};"))
            .map(|(choices, _)| choices)
            .expect("convex/lib/elite.ts declares ELITE_METHOD_CHOICES");
        let server_lists: Vec<&str> = choices
            .lines()
            .filter(|line| line.contains(": ['"))
            .collect();
        assert_eq!(server_lists.len(), EliteList::IN_REPORT_ORDER.len());
        for list in EliteList::IN_REPORT_ORDER {
            let line = server_lists
                .iter()
                .find(|line| line.trim_start().starts_with(&format!("{}:", list.key())))
                .unwrap_or_else(|| panic!("the server has no {} list", list.key()));
            let server_methods: Vec<&str> = line.split('\'').skip(1).step_by(2).collect();
            let cli_methods: Vec<&str> = list.offered().map(Method::server_name).collect();
            assert_eq!(cli_methods, server_methods, "{}", list.key());
        }
    }

    #[test]
    fn sends_methods_as_the_server_names_them() {
        assert_eq!(Method::PercentA.server_name(), "percentA");
        assert_eq!(Method::Qpoints.server_name(), "qpoints");
        assert_eq!(Method::Qmasters.server_name(), "qmasters");
        assert_eq!(Method::Sinclair.server_name(), "sinclair");
    }

    #[test]
    fn reads_an_answer_that_names_a_method_the_cli_does_not_know() {
        let ranking = json!({ "method": "futureScore", "men": [], "women": [] });
        let answer: EliteAnswer = serde_json::from_value(json!({
            "members": 2,
            "lists": {
                "overall": ranking, "youth": ranking, "junior": ranking,
                "senior": ranking, "masters": ranking,
            },
            "rankings": { "overall": { "futureScore": { "men": [], "women": [] } } },
        }))
        .unwrap();
        assert_eq!(answer.members, 2);
        assert!(answer.lists.overall.women.is_empty());
    }

    pub(crate) fn default_methods() -> ChosenMethods {
        methods(|_| None).unwrap()
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
        let ranking = || EliteRanking {
            men: vec![],
            women: vec![row("Ada", 100.0)],
        };
        let lists = EliteLists {
            overall: ranking(),
            youth: ranking(),
            junior: ranking(),
            senior: ranking(),
            masters: ranking(),
        };
        let exported = report(&lists, &default_methods()).to_json();
        let keys: Vec<&String> = exported.as_object().unwrap().keys().collect();
        assert_eq!(keys.len(), 10);
        assert_eq!(exported["overall_women"][0]["athlete"], "Ada");
        assert_eq!(exported["overall_women"][0]["score"], 100.0);
        assert_eq!(exported["overall_women"][0]["date"], "2025-03-01");
        assert_eq!(exported["masters_men"], json!([]));
        assert_eq!(exported["senior_women"][0]["class"], "63kg");
        let shown = report(&lists, &default_methods()).to_text();
        assert!(shown.contains("MASTERS — WOMEN (Q-masters)"));
        assert!(shown.contains("OVERALL — WOMEN (% of A)"));
    }

    #[test]
    fn defaults_to_the_current_calendar_year_as_leaderboard_does() {
        let args = EliteArgs::parse_from(["elite", "Carolina"]);
        let this_year = current_year();
        assert_eq!(
            range(&args),
            (format!("{this_year}-01-01"), format!("{this_year}-12-31"))
        );
        assert_eq!(
            range(&args),
            crate::commands::leaderboard::range(None, None, None)
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
