use std::collections::{HashMap, HashSet};

use super::{
    analytics::percentage,
    filters::filter_options,
    loading::{load_error, load_meet_data},
    models::{Athlete, LiftingResult, Meet, UpcomingMeetsQuery, normalize},
    ui::{DataMetric, DataPage, DataStatus, DataTable, EmptyTableRow, FilterSelect, TableSkeleton},
};
use crate::utils::api::{queries, query, query_with};
use leptos::prelude::*;

#[component]
pub fn WsoDashboard() -> impl IntoView {
    let (meet, set_meet) = signal(String::new());
    let (wso, set_wso) = signal(String::new());
    let upcoming = LocalResource::new(|| async {
        query_with::<Vec<Meet>, _>(queries::UPCOMING_MEETS, &UpcomingMeetsQuery::current()).await
    });
    let completed =
        LocalResource::new(|| async { query::<Vec<Meet>>(queries::COMPLETED_MEETS).await });
    let wsos = LocalResource::new(|| async { query::<Vec<String>>(queries::WSO_LIST).await });
    let athletes =
        LocalResource::new(move || load_meet_data::<Athlete>(meet.get(), queries::MEET_ATHLETES));
    let results = LocalResource::new(move || {
        load_meet_data::<LiftingResult>(meet.get(), queries::MEET_RESULTS)
    });
    view! { <DataPage heading="WSO Meet Dashboard" intro="See participation, make rates, lifted volume, and athlete totals for one WSO at a meet.">
        {move || upcoming.with(|upcoming| completed.with(|completed| match (upcoming, completed) {
            (Some(Ok(upcoming)), Some(Ok(completed))) => {
                let mut meets = upcoming.iter().chain(completed.iter()).map(|row| row.name.clone()).collect::<Vec<_>>();
                meets.sort();
                meets.dedup();
                view! { <div class="data-filters">
                    <FilterSelect
                        label="Meet"
                        placeholder="Choose a meet"
                        values=meets
                        selected=meet.get()
                        wide=true
                        on_select=move |value: String| {
                            set_meet.set(value);
                            set_wso.set(String::new());
                        }
                    />
                    {move || wsos.with(|response| match response {
                        Some(Ok(rows)) if !meet.get().is_empty() => {
                            let options = filter_options(rows.iter().map(String::as_str));
                            view! { <FilterSelect label="WSO" placeholder="Choose a WSO" values=options selected=wso.get() wide=true on_select=move |value| set_wso.set(value) /> }.into_any()
                        }
                        Some(Err(error)) => load_error("WSOs", error),
                        _ => ().into_any(),
                    })}
                </div> }.into_any()
            }
            (Some(Err(error)), _) | (_, Some(Err(error))) => load_error("meets", error),
            _ => view! { <DataStatus message="Loading meets…" /> }.into_any(),
        }))}
        {move || if wso.get().is_empty() { view! { <DataStatus message="Choose a meet and WSO to view its dashboard." /> }.into_any() } else { athletes.with(|athlete_response| results.with(|result_response| match (athlete_response, result_response) { (Some(Ok(athletes)), Some(Ok(results))) => dashboard(athletes, results, &wso.get()), (Some(Err(error)), _) | (_, Some(Err(error))) => load_error("WSO dashboard", error), _ => view! { <TableSkeleton columns=8 /> }.into_any() })) }}
    </DataPage> }
}

/// Shown for a value with nothing to compute it from.
const NO_VALUE: &str = "\u{2014}";

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
        _ => NO_VALUE.to_owned(),
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
        rows,
    } = build_dashboard_data(athletes, results, selected_wso);
    let rows = rows.into_iter().map(|row| view! { <tr><td>{row.name}</td><td>{row.gender}</td><td>{row.weight_class}</td><td>{row.club}</td><td>{row.entry_total}</td><td>{lift(row.snatch_best)}</td><td>{lift(row.cj_best)}</td><td>{lift(row.total)}</td></tr> }).collect_view();
    let weight_lifted = if attempts.attempts() == 0 {
        NO_VALUE.to_owned()
    } else {
        format!("{}kg", attempts.volume)
    };
    view! { <div class="data-metric-grid"><DataMetric label="Meet athletes" value=meet_athletes.to_string() /><DataMetric label="WSO athletes" value=wso_count(wso_athletes, wso_coverage) /><DataMetric label="Snatch makes" value=make_rate(attempts.snatch_makes, attempts.snatch_attempts) /><DataMetric label="C&J makes" value=make_rate(attempts.cj_makes, attempts.cj_attempts) /><DataMetric label="Combined makes" value=make_rate(attempts.makes(), attempts.attempts()) /><DataMetric label="Weight lifted" value=weight_lifted /></div>
    <DataTable><thead><tr><th>"Athlete"</th><th>"Gender"</th><th>"Class"</th><th>"Club"</th><th>"Entry total"</th><th>"Snatch"</th><th>"C&J"</th><th>"Total"</th></tr></thead><tbody>{(wso_athletes == 0).then(|| view! { <EmptyTableRow columns=8 message=empty_message(wso_coverage) /> })}{rows}</tbody></DataTable> }.into_any()
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
    meet_athletes: usize,
    wso_athletes: usize,
    /// How many roster rows name a WSO (synced entries carry none).
    wso_coverage: WsoCoverage,
    attempts: AttemptSummary,
    rows: Vec<WsoAthleteRow>,
}

fn build_dashboard_data(
    athletes: &[Athlete],
    results: &[LiftingResult],
    selected_wso: &str,
) -> WsoDashboardData {
    let members = athletes
        .iter()
        .filter(|athlete| {
            athlete
                .wso
                .as_deref()
                .is_some_and(|wso| normalize(wso) == normalize(selected_wso))
        })
        .collect::<Vec<_>>();
    let names = members
        .iter()
        .map(|row| normalize(&row.name))
        .collect::<HashSet<_>>();
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
        meet_athletes: athletes.len(),
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
            if labeled == 0 {
                WsoCoverage::None
            } else if labeled < athletes.len() {
                WsoCoverage::Partial
            } else {
                WsoCoverage::Full
            }
        },
        attempts: summary,
        rows,
    }
}

#[derive(Default)]
struct AttemptSummary {
    snatch_attempts: usize,
    snatch_makes: usize,
    cj_attempts: usize,
    cj_makes: usize,
    volume: f64,
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
                &mut summary.volume,
            );
        }
        for value in [row.cj1, row.cj2, row.cj3] {
            record(
                value,
                &mut summary.cj_attempts,
                &mut summary.cj_makes,
                &mut summary.volume,
            );
        }
    }
    summary
}
fn record(value: f64, attempts: &mut usize, makes: &mut usize, volume: &mut f64) {
    if value == 0.0 || !value.is_finite() {
        return;
    }
    *attempts += 1;
    if value > 0.0 {
        *makes += 1;
        *volume += value;
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
        let (mut attempts, mut makes, mut volume) = (0, 0, 0.0);
        record(-100.0, &mut attempts, &mut makes, &mut volume);
        record(0.0, &mut attempts, &mut makes, &mut volume);
        record(105.0, &mut attempts, &mut makes, &mut volume);
        assert_eq!((attempts, makes, volume), (2, 1, 105.0));
    }

    #[test]
    fn dashboard_attempt_summary_keeps_lift_types_separate() {
        let result = result("Athlete", 205.0);
        let summary = summarize_attempts([&result].into_iter());
        assert_eq!((summary.snatch_attempts, summary.snatch_makes), (2, 1));
        assert_eq!((summary.cj_attempts, summary.cj_makes), (3, 2));
        assert_eq!(summary.volume, 315.0);
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
    }
}
