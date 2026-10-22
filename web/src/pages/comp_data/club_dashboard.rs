use super::{
    format::yes_no,
    loading::{Load, LoadState, load_error, load_query, select_response},
    ui::{DataMetric, DataPage, DataStatus, DataTable, EmptyTableRow, FilterSelect, TableSkeleton},
};
use crate::utils::api::{queries, query_with};
use leptos::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
struct ClubQuery {
    club: String,
}
#[derive(Clone, PartialEq, Serialize)]
struct StatsQuery {
    club: String,
    meet: String,
}
/// `reference:clubMeets`: the club's meets, newest first.
#[derive(Clone, Deserialize)]
struct ClubMeets {
    meets: Vec<ClubMeet>,
}
#[derive(Clone, Deserialize)]
struct ClubMeet {
    meet: String,
    has_results: bool,
}
#[derive(Clone, Deserialize)]
struct MeetStats {
    total_athletes: i64,
    gold_medals: i64,
    silver_medals: i64,
    bronze_medals: i64,
    total_prs: i64,
    perfect_6_for_6: i64,
    total_weight_lifted: f64,
    snatch_make_rate: i64,
    cj_make_rate: i64,
    combined_make_rate: i64,
    athlete_results: Vec<AthleteResult>,
}
#[derive(Clone, Deserialize)]
struct AthleteResult {
    name: String,
    weight_class: String,
    snatch_best: f64,
    cj_best: f64,
    total: f64,
    body_weight: f64,
    snatch_medal: Option<String>,
    cj_medal: Option<String>,
    total_medal: Option<String>,
    is_pr: bool,
    perfect_lifts: bool,
}

#[component]
pub fn ClubDashboard() -> impl IntoView {
    let (club, set_club) = signal(String::new());
    let (meet, set_meet) = signal(String::new());
    let clubs = load_query::<Vec<String>>(queries::CLUBS);
    let club_meets = Load::new(
        move || club.get(),
        |club| async move {
            if club.is_empty() {
                return Ok(Vec::new());
            }
            query_with::<ClubMeets, _>(queries::CLUB_MEETS, &ClubQuery { club })
                .await
                .map(|answer| club_meet_choices(answer.meets))
                .map_err(|error| error.to_string())
        },
    );
    let stats = Load::new(
        move || StatsQuery {
            club: club.get(),
            meet: meet.get(),
        },
        |query| async move {
            if query.club.is_empty() || query.meet.is_empty() {
                return Ok(None);
            }
            query_with::<MeetStats, _>(queries::CLUB_MEET_STATS, &query)
                .await
                .map(Some)
                .map_err(|error| error.to_string())
        },
    );
    view! {
        <DataPage
            heading="Club Meet Dashboard"
            intro="Review a club’s athletes, medals, PRs, make rates, and meet totals."
        >
            {move || select_response(clubs, "Loading clubs…", "clubs", |clubs| view! {
                <div class="data-filters">
                    <FilterSelect
                        label="Club"
                        placeholder="Choose a club"
                        values=clubs.to_vec()
                        selected=club
                        wide=true
                        on_select=move |value: String| {
                            set_club.set(value);
                            set_meet.set(String::new());
                        }
                    />
                    {move || if club.with(String::is_empty) { ().into_any() } else {
                        club_meets.with(|state| match state {
                            LoadState::Ready(meets) if meets.is_empty() => {
                                view! { <p class="data-status">"This club has no completed meets yet."</p> }.into_any()
                            }
                            LoadState::Ready(meets) => {
                                view! { <FilterSelect label="Meet" placeholder="Choose a completed meet" values=meets.to_vec() selected=meet wide=true on_select=move |value| set_meet.set(value) /> }.into_any()
                            }
                            LoadState::Failed(error) => load_error("club meets", error, move || club_meets.retry()),
                            LoadState::Loading => view! { <p class="data-status">"Loading the club’s meets…"</p> }.into_any(),
                        })
                    }}
                </div>
            }.into_any())}
            {move || if club.with(String::is_empty) || meet.with(String::is_empty) {
                view! { <DataStatus message="Choose a club and completed meet to view its dashboard." /> }.into_any()
            } else {
                stats.with(|state| match state {
                    LoadState::Loading => view! { <TableSkeleton columns=10 /> }.into_any(),
                    LoadState::Failed(error) => load_error("club dashboard", error, move || stats.retry()),
                    LoadState::Ready(Some(stats)) => dashboard(stats),
                    LoadState::Ready(None) => view! { <DataStatus message="Choose a club and completed meet to view its dashboard." /> }.into_any(),
                })
            }}
        </DataPage>
    }
}

/// The Meet picker's choices: the club's meets that have results, in the
/// server's order (newest first). A meet the club has only registered for has
/// none yet, so it is left out, as the picker's "Choose a completed meet" says.
fn club_meet_choices(meets: Vec<ClubMeet>) -> Vec<String> {
    meets
        .into_iter()
        .filter(|meet| meet.has_results)
        .map(|meet| meet.meet)
        .collect()
}

fn medal(value: &Option<String>) -> String {
    value
        .as_deref()
        .map(|value| {
            let mut characters = value.chars();
            characters
                .next()
                .map(|first| first.to_uppercase().collect::<String>() + characters.as_str())
                .unwrap_or_default()
        })
        .unwrap_or_else(|| "—".to_owned())
}

fn dashboard_metrics(stats: &MeetStats) -> Vec<(&'static str, String)> {
    vec![
        ("Athletes", stats.total_athletes.to_string()),
        ("Gold medals", stats.gold_medals.to_string()),
        ("Silver medals", stats.silver_medals.to_string()),
        ("Bronze medals", stats.bronze_medals.to_string()),
        ("Total PRs", stats.total_prs.to_string()),
        ("6 for 6", stats.perfect_6_for_6.to_string()),
        ("Weight lifted", format!("{}kg", stats.total_weight_lifted)),
        ("Snatch makes", format!("{}%", stats.snatch_make_rate)),
        ("C&J makes", format!("{}%", stats.cj_make_rate)),
        ("Combined makes", format!("{}%", stats.combined_make_rate)),
    ]
}

fn dashboard(stats: &MeetStats) -> AnyView {
    let metrics = dashboard_metrics(stats)
        .into_iter()
        .map(|(label, value)| view! { <DataMetric label value /> })
        .collect_view();
    let is_empty = stats.athlete_results.is_empty();
    let rows = stats.athlete_results.iter().map(|row| view! { <tr><td>{row.name.clone()}</td><td>{row.weight_class.clone()}</td><td>{row.body_weight}</td><td>{row.snatch_best}</td><td>{medal(&row.snatch_medal)}</td><td>{row.cj_best}</td><td>{medal(&row.cj_medal)}</td><td>{row.total}</td><td>{medal(&row.total_medal)}</td><td>{yes_no(row.is_pr)}</td><td>{yes_no(row.perfect_lifts)}</td></tr> }).collect_view();
    view! { <div class="data-metric-grid">{metrics}</div>
    <DataTable><thead><tr><th>"Athlete"</th><th>"Class"</th><th>"Bodyweight"</th><th>"Snatch"</th><th>"Snatch medal"</th><th>"C&J"</th><th>"C&J medal"</th><th>"Total"</th><th>"Total medal"</th><th>"PR"</th><th>"6 for 6"</th></tr></thead><tbody>{is_empty.then(|| view! { <EmptyTableRow columns=11 message="No club results were found for this meet." /> })}{rows}</tbody></DataTable> }.into_any()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stats_payload_deserializes() {
        let stats: MeetStats = serde_json::from_str(r#"{"total_athletes":1,"gold_medals":1,"silver_medals":0,"bronze_medals":0,"total_prs":1,"perfect_6_for_6":1,"total_weight_lifted":225.0,"snatch_make_rate":100,"cj_make_rate":100,"combined_make_rate":100,"athlete_results":[]}"#).unwrap();
        assert_eq!(stats.total_athletes, 1);
    }

    #[test]
    fn medals_are_title_case() {
        assert_eq!(medal(&Some("gold".to_owned())), "Gold");
        assert_eq!(medal(&Some("silver".to_owned())), "Silver");
        assert_eq!(medal(&Some("bronze".to_owned())), "Bronze");
        assert_eq!(medal(&None), "—");
    }

    #[test]
    fn dashboard_metrics_have_stable_labels_and_units() {
        let stats: MeetStats = serde_json::from_str(r#"{"total_athletes":1,"gold_medals":1,"silver_medals":0,"bronze_medals":0,"total_prs":1,"perfect_6_for_6":0,"total_weight_lifted":225.0,"snatch_make_rate":67,"cj_make_rate":67,"combined_make_rate":67,"athlete_results":[]}"#).unwrap();
        let metrics = dashboard_metrics(&stats);
        assert_eq!(metrics.first(), Some(&("Athletes", "1".to_owned())));
        assert!(metrics.contains(&("Weight lifted", "225kg".to_owned())));
    }

    #[test]
    fn the_meet_choices_are_the_clubs_meets_with_results_in_the_servers_order() {
        let answer: ClubMeets = serde_json::from_str(
            r#"{"meets":[
                {"meet":"Upcoming Nationals","date":"2026-12-04","status":"upcoming","has_results":false},
                {"meet":"Zephyr Classic","date":"2026-08-10","status":"completed","has_results":true},
                {"meet":"Awaiting Results","date":"2026-06-01","status":"completed","has_results":false},
                {"meet":"Arnold Open","date":"2026-03-01","status":"completed","has_results":true},
                {"meet":"Undated Open","date":null,"status":null,"has_results":true}
            ],"truncated":false}"#,
        )
        .unwrap();
        assert_eq!(
            club_meet_choices(answer.meets),
            ["Zephyr Classic", "Arnold Open", "Undated Open"]
        );
        assert!(club_meet_choices(Vec::new()).is_empty());
    }
}
