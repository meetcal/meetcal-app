use std::collections::{HashMap, HashSet};

use super::{
    analytics::percentage,
    format::{display_gender, display_weight_class},
    loading::{Load, LoadState, load_error, load_meet_data, load_query},
    models::{Athlete, LiftingResult, Meet, UpcomingMeetsQuery, normalize},
    ui::{DataMetric, DataPage, DataStatus, DataTable, EmptyTableRow, FilterSelect, TableSkeleton},
};
use crate::utils::api::{queries, query_with};
use leptos::prelude::*;

#[component]
pub fn WsoDashboard() -> impl IntoView {
    let (meet, set_meet) = signal(String::new());
    let (wso, set_wso) = signal(String::new());
    let upcoming_meets = Load::new(
        || (),
        |()| async {
            query_with::<Vec<Meet>, _>(queries::UPCOMING_MEETS, &UpcomingMeetsQuery::current())
                .await
                .map_err(|error| error.to_string())
        },
    );
    let completed_meets = load_query::<Vec<Meet>>(queries::COMPLETED_MEETS);
    let athletes = Load::new(
        move || meet.get(),
        |meet| load_meet_data::<Athlete>(meet, queries::MEET_ATHLETES),
    );
    let results = Load::new(
        move || meet.get(),
        |meet| load_meet_data::<LiftingResult>(meet, queries::MEET_RESULTS),
    );
    view! { <DataPage heading="WSO Meet Dashboard" intro="See participation, make rates, lifted volume, and athlete totals for one WSO at a meet.">
        {move || upcoming_meets.with(|upcoming| completed_meets.with(|completed| match (upcoming, completed) {
            (LoadState::Ready(upcoming), LoadState::Ready(completed)) => {
                let mut meets = upcoming.iter().chain(completed.iter()).map(|row| row.name.clone()).collect::<Vec<_>>();
                meets.sort();
                meets.dedup();
                view! { <div class="data-filters">
                    <FilterSelect
                        label="Meet"
                        placeholder="Choose a meet"
                        values=meets
                        selected=meet
                        wide=true
                        on_select=move |value: String| {
                            set_meet.set(value);
                            set_wso.set(String::new());
                        }
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
                                    view! { <FilterSelect label="WSO" placeholder="Choose a WSO" values=options selected=wso wide=true on_select=move |value| set_wso.set(value) /> }.into_any()
                                }
                            }
                            LoadState::Failed(error) => load_error("the meet’s WSOs", error, move || athletes.retry()),
                            LoadState::Loading => view! { <DataStatus message="Loading the meet’s WSOs…" /> }.into_any(),
                        })
                    }}
                </div> }.into_any()
            }
            (LoadState::Failed(error), _) | (_, LoadState::Failed(error)) => load_error("meets", error, move || {
                upcoming_meets.retry_failed();
                completed_meets.retry_failed();
            }),
            _ => view! { <DataStatus message="Loading meets…" /> }.into_any(),
        }))}
        {move || if wso.get().is_empty() { view! { <DataStatus message="Choose a meet and WSO to view its dashboard." /> }.into_any() } else { athletes.with(|athlete_state| results.with(|result_state| match (athlete_state, result_state) { (LoadState::Ready(athletes), LoadState::Ready(results)) => dashboard(athletes, results, &wso.get()), (LoadState::Failed(error), _) | (_, LoadState::Failed(error)) => load_error("WSO dashboard", error, move || { athletes.retry_failed(); results.retry_failed(); }), _ => view! { <TableSkeleton columns=8 /> }.into_any() })) }}
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

fn dashboard(athletes: &[Athlete], results: &[LiftingResult], selected_wso: &str) -> AnyView {
    let WsoDashboardData {
        meet_athletes,
        wso_athletes,
        attempts,
        weight_lifted,
        rows,
    } = build_dashboard_data(athletes, results, selected_wso);
    let rows = rows.into_iter().map(|row| view! { <tr><td>{row.name}</td><td>{display_gender(&row.gender)}</td><td>{display_weight_class(&row.weight_class)}</td><td>{row.club}</td><td>{row.entry_total}</td><td>{row.snatch_best}</td><td>{row.cj_best}</td><td>{row.total}</td></tr> }).collect_view();
    view! { <div class="data-metric-grid"><DataMetric label="Meet athletes" value=meet_athletes.to_string() /><DataMetric label="WSO athletes" value=wso_athletes.to_string() /><DataMetric label="Snatch makes" value=format!("{:.1}%", percentage(attempts.snatch_makes, attempts.snatch_attempts)) /><DataMetric label="C&J makes" value=format!("{:.1}%", percentage(attempts.cj_makes, attempts.cj_attempts)) /><DataMetric label="Combined makes" value=format!("{:.1}%", percentage(attempts.makes(), attempts.attempts())) /><DataMetric label="Weight lifted" value=format!("{weight_lifted}kg") /></div>
    <DataTable><thead><tr><th>"Athlete"</th><th>"Gender"</th><th>"Class"</th><th>"Club"</th><th>"Entry total"</th><th>"Snatch"</th><th>"C&J"</th><th>"Total"</th></tr></thead><tbody>{(wso_athletes == 0).then(|| view! { <EmptyTableRow columns=8 message="No athletes from this WSO were found at the meet." /> })}{rows}</tbody></DataTable> }.into_any()
}

struct WsoAthleteRow {
    name: String,
    gender: String,
    weight_class: String,
    club: String,
    entry_total: f64,
    snatch_best: f64,
    cj_best: f64,
    total: f64,
}

struct WsoDashboardData {
    /// Distinct athletes on the roster (by folded name): an athlete entered
    /// in two divisions is one athlete, as the Club Dashboard counts them.
    meet_athletes: usize,
    wso_athletes: usize,
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
                snatch_best: result.map(|row| row.snatch_best).unwrap_or_default(),
                cj_best: result.map(|row| row.cj_best).unwrap_or_default(),
                total: result.map(|row| row.total).unwrap_or_default(),
            }
        })
        .collect();
    WsoDashboardData {
        meet_athletes,
        wso_athletes: members.len(),
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
        assert_eq!(data.rows[0].total, 215.0);
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
