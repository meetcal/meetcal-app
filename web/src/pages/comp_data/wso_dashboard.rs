use std::collections::{HashMap, HashSet};

use super::{
    analytics::percentage,
    filters::filter_options,
    loading::{load_error, load_meet_data},
    models::{Athlete, LiftingResult, Meet, normalize},
    ui::{DataMetric, DataPage, DataStatus, DataTable, EmptyTableRow, FilterSelect, TableSkeleton},
};
use crate::utils::api::get_api_response;
use leptos::prelude::*;

#[component]
pub fn WsoDashboard() -> impl IntoView {
    let (meet, set_meet) = signal(String::new());
    let (wso, set_wso) = signal(String::new());
    let upcoming = LocalResource::new(|| async { get_api_response::<Meet>("/meets").await });
    let completed =
        LocalResource::new(|| async { get_api_response::<Meet>("/meets/completed").await });
    let wsos = LocalResource::new(|| async { get_api_response::<String>("/data/wso").await });
    let athletes =
        LocalResource::new(move || load_meet_data::<Athlete>(meet.get(), "/meets/athletes"));
    let results =
        LocalResource::new(move || load_meet_data::<LiftingResult>(meet.get(), "/lifting-results"));
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

fn dashboard(athletes: &[Athlete], results: &[LiftingResult], selected_wso: &str) -> AnyView {
    let WsoDashboardData {
        meet_athletes,
        wso_athletes,
        attempts,
        rows,
    } = build_dashboard_data(athletes, results, selected_wso);
    let rows = rows.into_iter().map(|row| view! { <tr><td>{row.name}</td><td>{row.gender}</td><td>{row.weight_class}</td><td>{row.club}</td><td>{row.entry_total}</td><td>{row.snatch_best}</td><td>{row.cj_best}</td><td>{row.total}</td></tr> }).collect_view();
    view! { <div class="data-metric-grid"><DataMetric label="Meet athletes" value=meet_athletes.to_string() /><DataMetric label="WSO athletes" value=wso_athletes.to_string() /><DataMetric label="Snatch makes" value=format!("{:.1}%", percentage(attempts.snatch_makes, attempts.snatch_attempts)) /><DataMetric label="C&J makes" value=format!("{:.1}%", percentage(attempts.cj_makes, attempts.cj_attempts)) /><DataMetric label="Combined makes" value=format!("{:.1}%", percentage(attempts.makes(), attempts.attempts())) /><DataMetric label="Weight lifted" value=format!("{}kg", attempts.volume) /></div>
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
    meet_athletes: usize,
    wso_athletes: usize,
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
                snatch_best: result.map(|row| row.snatch_best).unwrap_or_default(),
                cj_best: result.map(|row| row.cj_best).unwrap_or_default(),
                total: result.map(|row| row.total).unwrap_or_default(),
            }
        })
        .collect();
    WsoDashboardData {
        meet_athletes: athletes.len(),
        wso_athletes: members.len(),
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
        assert_eq!(data.rows[0].total, 215.0);
    }
}
