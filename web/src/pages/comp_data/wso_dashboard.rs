use std::collections::{HashMap, HashSet};

use super::{
    address::{HistoryEntry, query_param, use_page_address},
    analytics::percentage,
    catalog,
    format::{NO_VALUE, display_gender, display_weight_class},
    loading::{Load, LoadState, load_error, load_meet_data, select_response},
    meets::load_meet_catalog,
    models::{Athlete, LiftingResult, normalize},
    ui::{DataMetric, DataPage, DataStatus, FilterSelect, StaticRowsTable, TableSkeleton},
};
use crate::utils::api::queries;
use leptos::prelude::*;

#[component]
pub fn WsoDashboard() -> impl IntoView {
    let page = use_page_address("/wso-dashboard");
    let meet = query_param("meet");
    let wso = query_param("wso");
    let meets = load_meet_catalog();
    let athletes = Load::new(
        move || meet.get(),
        |meet| load_meet_data::<Athlete>(meet, queries::MEET_ATHLETES),
    );
    let results = Load::new(
        move || meet.get(),
        |meet| load_meet_data::<LiftingResult>(meet, queries::MEET_RESULTS),
    );
    view! { <DataPage page=catalog::WSO_DASHBOARD>
        {move || select_response(meets, "Loading meets…", "meets", |meets| {
                let meets = meets.iter().map(|row| row.name.clone()).collect::<Vec<_>>();
                view! { <div class="data-filters">
                    <FilterSelect
                        label="Meet"
                        placeholder="Choose a meet"
                        values=meets
                        selected=meet
                        wide=true
                        on_select=move |meet: String| page.show(&[("meet", &meet)], HistoryEntry::Push)
                    />
                    // The WSOs the meet's athletes registered under, spelled as
                    // the roster spells them: every one can be chosen, and each
                    // matches its athletes.
                    {move || if meet.with(String::is_empty) { ().into_any() } else {
                        athletes.with(|state| match state {
                            LoadState::Ready(rows) => {
                                let options = roster_wsos(rows);
                                if options.is_empty() {
                                    view! { <DataStatus message="This meet’s start list doesn’t list athletes’ WSOs." /> }.into_any()
                                } else {
                                    view! { <FilterSelect label="WSO" placeholder="Choose a WSO" values=options selected=wso wide=true on_select=move |wso: String| page.show(&[("meet", &meet.get_untracked()), ("wso", &wso)], HistoryEntry::Push) /> }.into_any()
                                }
                            }
                            LoadState::Failed(error) => load_error("the meet’s WSOs", error, move || athletes.retry()),
                            LoadState::Loading => view! { <DataStatus message="Loading the meet’s WSOs…" /> }.into_any(),
                        })
                    }}
                </div> }.into_any()
        })}
        {move || if meet.with(String::is_empty) || wso.with(String::is_empty) { view! { <DataStatus message="Choose a meet and WSO to view its dashboard." /> }.into_any() } else { athletes.with(|athlete_state| results.with(|result_state| match (athlete_state, result_state) { (LoadState::Ready(athletes), LoadState::Ready(results)) => dashboard(athletes, results, &wso.get()), (LoadState::Failed(error), _) | (_, LoadState::Failed(error)) => load_error("WSO dashboard", error, move || { athletes.retry_failed(); results.retry_failed(); }), _ => view! { <TableSkeleton columns=8 /> }.into_any() })) }}
    </DataPage> }
}

/// The WSOs a meet's athletes registered under, as the roster spells them.
fn roster_wsos(athletes: &[Athlete]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut wsos = athletes
        .iter()
        .filter_map(|athlete| athlete.wso.as_deref())
        .map(str::trim)
        .filter(|wso| !wso.is_empty() && seen.insert(normalize(wso)))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    wsos.sort_by_key(|wso| normalize(wso));
    wsos
}

/// A make rate, or a dash when there were no attempts: a meet with no
/// results yet has no 0% make rate.
fn make_rate(makes: usize, attempts: usize) -> String {
    if attempts == 0 {
        NO_VALUE.to_owned()
    } else {
        format!("{:.1}%", percentage(makes, attempts))
    }
}

/// A lift or total, or a dash for an athlete with no result at the meet.
fn lift(value: Option<f64>) -> String {
    value.map_or_else(|| NO_VALUE.to_owned(), |value| value.to_string())
}

/// How much of a meet's roster names a WSO: synced entries carry none, and
/// a roster can mix them with a hand-loaded start list's rows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WsoCoverage {
    None,
    Partial,
    Full,
}

/// The WSO athlete count: a number only when every roster row names a WSO;
/// otherwise the athletes found and a `+` (some unlabeled ones may be this
/// WSO's too), or a dash when none was found.
fn wso_count(count: usize, coverage: WsoCoverage) -> String {
    match coverage {
        WsoCoverage::Full => count.to_string(),
        WsoCoverage::Partial if count > 0 => format!("{count}+"),
        WsoCoverage::Partial | WsoCoverage::None => NO_VALUE.to_owned(),
    }
}

/// Why no WSO athlete is listed: the roster carries no WSOs at all, only
/// some (an unlabeled athlete may be this WSO's), or none of them is this one.
fn empty_message(coverage: WsoCoverage) -> &'static str {
    match coverage {
        WsoCoverage::Full => "No athletes from this WSO were found at the meet.",
        WsoCoverage::Partial => {
            "No athletes are listed under this WSO, but part of this meet's start list doesn't include WSOs."
        }
        WsoCoverage::None => {
            "This meet's start list doesn't include WSOs, so its WSO athletes can't be shown."
        }
    }
}

fn dashboard(athletes: &[Athlete], results: &[LiftingResult], selected_wso: &str) -> AnyView {
    let WsoDashboardData {
        meet_athletes,
        wso_athletes,
        wso_coverage,
        attempts,
        weight_lifted,
        rows,
    } = build_dashboard_data(athletes, results, selected_wso);
    let weight_lifted = if attempts.attempts() == 0 {
        NO_VALUE.to_owned()
    } else {
        format!("{weight_lifted}kg")
    };
    view! { <div class="data-metric-grid"><DataMetric label="Meet athletes" value=meet_athletes.to_string() /><DataMetric label="WSO athletes" value=wso_count(wso_athletes, wso_coverage) /><DataMetric label="Snatch makes" value=make_rate(attempts.snatch_makes, attempts.snatch_attempts) /><DataMetric label="C&J makes" value=make_rate(attempts.cj_makes, attempts.cj_attempts) /><DataMetric label="Combined makes" value=make_rate(attempts.makes(), attempts.attempts()) /><DataMetric label="Weight lifted" value=weight_lifted /></div>
    <StaticRowsTable headers=ATHLETE_HEADERS rows row=athlete_row empty_message=empty_message(wso_coverage) /> }.into_any()
}

const ATHLETE_HEADERS: &[&str] = &[
    "Athlete",
    "Gender",
    "Class",
    "Club",
    "Entry total",
    "Snatch",
    "C&J",
    "Total",
];

fn athlete_row(row: &WsoAthleteRow) -> AnyView {
    view! { <tr><td>{row.name.clone()}</td><td>{display_gender(&row.gender)}</td><td>{display_weight_class(&row.weight_class)}</td><td>{row.club.clone()}</td><td>{row.entry_total}</td><td>{lift(row.snatch_best)}</td><td>{lift(row.cj_best)}</td><td>{lift(row.total)}</td></tr> }.into_any()
}

struct WsoAthleteRow {
    name: String,
    gender: String,
    weight_class: String,
    club: String,
    entry_total: f64,
    /// None for an athlete with no result at the meet (yet).
    snatch_best: Option<f64>,
    cj_best: Option<f64>,
    total: Option<f64>,
}

struct WsoDashboardData {
    /// Distinct athletes on the roster (by folded name): an athlete entered
    /// in two divisions is one athlete, as the Club Dashboard counts them.
    meet_athletes: usize,
    wso_athletes: usize,
    /// How many roster rows name a WSO (synced entries carry none).
    wso_coverage: WsoCoverage,
    attempts: AttemptSummary,
    /// The sum of each WSO athlete's best total, as the Club Dashboard's
    /// "Weight lifted" (`total_weight_lifted`) is a sum of totals.
    weight_lifted: f64,
    rows: Vec<WsoAthleteRow>,
}

fn build_dashboard_data(
    athletes: &[Athlete],
    results: &[LiftingResult],
    selected_wso: &str,
) -> WsoDashboardData {
    let meet_athletes = athletes
        .iter()
        .map(|athlete| normalize(&athlete.name))
        .collect::<HashSet<_>>()
        .len();
    // Each WSO athlete once, as first listed.
    let mut names = HashSet::new();
    let members = athletes
        .iter()
        .filter(|athlete| {
            athlete
                .wso
                .as_deref()
                .is_some_and(|wso| normalize(wso) == normalize(selected_wso))
                && names.insert(normalize(&athlete.name))
        })
        .collect::<Vec<_>>();
    let member_results = results
        .iter()
        .filter(|row| names.contains(&normalize(&row.name)))
        .collect::<Vec<_>>();
    let summary = summarize_attempts(member_results.iter().copied());
    let mut best_results = HashMap::new();
    for result in member_results {
        let key = normalize(&result.name);
        best_results
            .entry(key)
            .and_modify(|best: &mut &LiftingResult| {
                if result.total > best.total {
                    *best = result;
                }
            })
            .or_insert(result);
    }
    let weight_lifted = best_results.values().map(|row| row.total.max(0.0)).sum();
    let rows = members
        .iter()
        .map(|athlete| {
            let result = best_results.get(&normalize(&athlete.name)).copied();
            WsoAthleteRow {
                name: athlete.name.clone(),
                gender: athlete.gender.clone(),
                weight_class: athlete.weight_class.clone(),
                club: athlete.club.clone(),
                entry_total: athlete.entry_total,
                snatch_best: result.map(|row| row.snatch_best),
                cj_best: result.map(|row| row.cj_best),
                total: result.map(|row| row.total),
            }
        })
        .collect();
    WsoDashboardData {
        meet_athletes,
        wso_athletes: members.len(),
        wso_coverage: {
            let labeled = athletes
                .iter()
                .filter(|athlete| {
                    athlete
                        .wso
                        .as_deref()
                        .is_some_and(|wso| !wso.trim().is_empty())
                })
                .count();
            // An empty roster (no start list yet) lacks no WSOs: nobody is on it.
            if labeled == athletes.len() {
                WsoCoverage::Full
            } else if labeled == 0 {
                WsoCoverage::None
            } else {
                WsoCoverage::Partial
            }
        },
        attempts: summary,
        weight_lifted,
        rows,
    }
}

#[derive(Default)]
struct AttemptSummary {
    snatch_attempts: usize,
    snatch_makes: usize,
    cj_attempts: usize,
    cj_makes: usize,
}

impl AttemptSummary {
    fn attempts(&self) -> usize {
        self.snatch_attempts + self.cj_attempts
    }
    fn makes(&self) -> usize {
        self.snatch_makes + self.cj_makes
    }
}

fn summarize_attempts<'a>(results: impl Iterator<Item = &'a LiftingResult>) -> AttemptSummary {
    let mut summary = AttemptSummary::default();
    for row in results {
        for value in [row.snatch1, row.snatch2, row.snatch3] {
            record(
                value,
                &mut summary.snatch_attempts,
                &mut summary.snatch_makes,
            );
        }
        for value in [row.cj1, row.cj2, row.cj3] {
            record(value, &mut summary.cj_attempts, &mut summary.cj_makes);
        }
    }
    summary
}

fn record(value: f64, attempts: &mut usize, makes: &mut usize) {
    if value == 0.0 || !value.is_finite() {
        return;
    }
    *attempts += 1;
    if value > 0.0 {
        *makes += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pages::comp_data::models::LiftResult;

    fn result(name: &str, total: f64) -> LiftingResult {
        LiftingResult {
            name: name.to_owned(),
            result: LiftResult {
                meet: "Meet".to_owned(),
                date: "2026-01-01".to_owned(),
                age: "Senior".to_owned(),
                body_weight: 70.0,
                snatch1: 90.0,
                snatch2: -95.0,
                snatch3: 0.0,
                snatch_best: total - 115.0,
                cj1: 110.0,
                cj2: 115.0,
                cj3: -120.0,
                cj_best: 115.0,
                total,
                adaptive: false,
            },
        }
    }
    #[test]
    fn misses_count_but_unrecorded_attempts_do_not() {
        let (mut attempts, mut makes) = (0, 0);
        record(-100.0, &mut attempts, &mut makes);
        record(0.0, &mut attempts, &mut makes);
        record(105.0, &mut attempts, &mut makes);
        assert_eq!((attempts, makes), (2, 1));
    }

    #[test]
    fn dashboard_attempt_summary_keeps_lift_types_separate() {
        let result = result("Athlete", 205.0);
        let summary = summarize_attempts([&result].into_iter());
        assert_eq!((summary.snatch_attempts, summary.snatch_makes), (2, 1));
        assert_eq!((summary.cj_attempts, summary.cj_makes), (3, 2));
    }

    #[test]
    fn dashboard_data_filters_wso_and_uses_each_athletes_best_result() {
        let athletes = [
            Athlete {
                name: "Alex".to_owned(),
                age: 25.0,
                club: "A".to_owned(),
                wso: Some("California North".to_owned()),
                gender: "Women".to_owned(),
                weight_class: "69kg".to_owned(),
                entry_total: 200.0,
                adaptive: false,
                session_number: None,
                session_platform: None,
            },
            Athlete {
                name: "Blair".to_owned(),
                age: 25.0,
                club: "B".to_owned(),
                wso: Some("Colorado".to_owned()),
                gender: "Women".to_owned(),
                weight_class: "69kg".to_owned(),
                entry_total: 200.0,
                adaptive: false,
                session_number: None,
                session_platform: None,
            },
        ];
        let results = [
            result(" Alex ", 205.0),
            result("Alex", 215.0),
            result("Blair", 220.0),
        ];

        let data = build_dashboard_data(&athletes, &results, "california   north");

        assert_eq!(data.wso_athletes, 1);
        assert_eq!(data.rows.len(), 1);
        assert_eq!(data.rows[0].name, "Alex");
        assert_eq!(data.rows[0].total, Some(215.0));
        assert_eq!(data.wso_coverage, WsoCoverage::Full);
    }

    #[test]
    fn a_roster_without_wsos_and_a_meet_without_results_show_no_numbers() {
        let athlete = |wso: Option<&str>| Athlete {
            name: "Casey".to_owned(),
            age: 30.0,
            club: "C".to_owned(),
            wso: wso.map(str::to_owned),
            gender: "Men".to_owned(),
            weight_class: "88".to_owned(),
            entry_total: 250.0,
            adaptive: false,
            session_number: None,
            session_platform: None,
        };
        let data = build_dashboard_data(&[athlete(None), athlete(Some(" "))], &[], "Carolina");
        assert_eq!(data.wso_coverage, WsoCoverage::None);
        assert_eq!(
            empty_message(data.wso_coverage),
            "This meet's start list doesn't include WSOs, so its WSO athletes can't be shown."
        );

        let data = build_dashboard_data(&[athlete(Some("Carolina"))], &[], "Carolina");
        assert_eq!(data.wso_athletes, 1);
        assert_eq!(data.rows[0].total, None);
        assert_eq!(lift(data.rows[0].total), "\u{2014}");
        assert_eq!(make_rate(0, data.attempts.attempts()), "\u{2014}");
        assert_eq!(make_rate(1, 2), "50.0%");
    }

    #[test]
    fn a_roster_with_some_wsos_never_claims_none_attended() {
        let athlete = |name: &str, wso: Option<&str>| Athlete {
            name: name.to_owned(),
            age: 30.0,
            club: "C".to_owned(),
            wso: wso.map(str::to_owned),
            gender: "Men".to_owned(),
            weight_class: "88".to_owned(),
            entry_total: 250.0,
            adaptive: false,
            session_number: None,
            session_platform: None,
        };
        let roster = [athlete("Dana", Some("Colorado")), athlete("Eli", None)];
        let data = build_dashboard_data(&roster, &[], "California North");
        assert_eq!(data.wso_coverage, WsoCoverage::Partial);
        assert_eq!(wso_count(data.wso_athletes, data.wso_coverage), "\u{2014}");
        assert_ne!(
            empty_message(data.wso_coverage),
            "No athletes from this WSO were found at the meet."
        );
        let data = build_dashboard_data(&roster, &[], "Colorado");
        assert_eq!(wso_count(data.wso_athletes, data.wso_coverage), "1+");
        assert_eq!(wso_count(2, WsoCoverage::Full), "2");

        let empty = build_dashboard_data(&[], &[], "Colorado");
        assert_eq!(empty.wso_coverage, WsoCoverage::Full);
        assert_eq!(wso_count(empty.wso_athletes, empty.wso_coverage), "0");
    }

    fn entrant(name: &str, wso: Option<&str>) -> Athlete {
        Athlete {
            name: name.to_owned(),
            age: 25.0,
            club: "Club".to_owned(),
            wso: wso.map(str::to_owned),
            gender: "Female".to_owned(),
            weight_class: "69".to_owned(),
            entry_total: 200.0,
            adaptive: false,
            session_number: None,
            session_platform: None,
        }
    }

    #[test]
    fn athletes_count_once_and_weight_lifted_sums_best_totals() {
        // Alex is entered in two divisions; Casey has no result yet.
        let athletes = [
            entrant("Alex", Some("Florida")),
            entrant("alex", Some("Florida")),
            entrant("Casey", Some("Florida")),
            entrant("Blair", Some("Georgia")),
        ];
        let results = [
            result("Alex", 205.0),
            result("Alex", 215.0),
            result("Blair", 220.0),
        ];

        let data = build_dashboard_data(&athletes, &results, "Florida");

        assert_eq!(data.meet_athletes, 3);
        assert_eq!(data.wso_athletes, 2);
        assert_eq!(data.rows.len(), 2);
        // Alex's best total only, as the Club Dashboard sums totals.
        assert_eq!(data.weight_lifted, 215.0);
    }

    #[test]
    fn the_wso_choices_are_the_rosters_own() {
        let athletes = [
            entrant("A", Some("Florida")),
            entrant("B", Some(" florida ")),
            entrant("C", Some("Carolina")),
            entrant("D", None),
            entrant("E", Some("")),
        ];
        assert_eq!(roster_wsos(&athletes), ["Carolina", "Florida"]);
        assert!(roster_wsos(&[entrant("A", None)]).is_empty());
    }
}
