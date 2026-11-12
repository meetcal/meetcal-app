use super::{
    address::{HistoryEntry, query_param, use_page_address},
    format::{NO_VALUE, display_body_weight, display_weight_class, yes_no},
    loading::{Load, LoadState, load_error, load_query, select_response},
    ui::{
        DataMetric, DataPage, DataStatus, DataTable, EmptyTableRow, FilterSelect, TableHead,
        TableSkeleton,
    },
};
use crate::utils::api::{queries, query_with};
use crate::utils::text::capitalize_first;
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
    truncated: bool,
}
#[derive(Clone, Deserialize)]
struct ClubMeet {
    meet: String,
    has_results: bool,
}
/// The Meet picker's choices, and whether the club has older meets left out of them.
#[derive(Default)]
struct MeetChoices {
    meets: Vec<String>,
    truncated: bool,
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
    let page = use_page_address("/club-dashboard");
    let club = query_param("club");
    let meet = query_param("meet");
    let clubs = load_query::<Vec<String>>(queries::CLUBS);
    let club_meets = Load::new(
        move || club.get(),
        |club| async move {
            if club.is_empty() {
                return Ok(MeetChoices::default());
            }
            query_with::<ClubMeets, _>(queries::CLUB_MEETS, &ClubQuery { club })
                .await
                .map(club_meet_choices)
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
                        on_select=move |club: String| page.show(&[("club", &club)], HistoryEntry::Push)
                    />
                    {move || if club.with(String::is_empty) { ().into_any() } else {
                        club_meets.with(|state| match state {
                            LoadState::Ready(choices) if choices.meets.is_empty() => {
                                view! { <p class="data-status">"This club has no completed meets yet."</p> }.into_any()
                            }
                            LoadState::Ready(choices) => {
                                view! {
                                    <FilterSelect label="Meet" placeholder="Choose a completed meet" values=choices.meets.clone() selected=meet wide=true on_select=move |meet: String| page.show(&[("club", &club.get_untracked()), ("meet", &meet)], HistoryEntry::Push) />
                                    {choices.truncated.then(|| view! { <p class="data-status">"Showing this club’s most recent meets."</p> })}
                                }.into_any()
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
                    LoadState::Loading => view! { <TableSkeleton columns=ATHLETE_HEADERS.len() /> }.into_any(),
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
fn club_meet_choices(answer: ClubMeets) -> MeetChoices {
    MeetChoices {
        meets: answer
            .meets
            .into_iter()
            .filter(|meet| meet.has_results)
            .map(|meet| meet.meet)
            .collect(),
        truncated: answer.truncated,
    }
}

fn medal(value: &Option<String>) -> String {
    value
        .as_deref()
        .map_or_else(|| NO_VALUE.to_owned(), capitalize_first)
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
    let rows = stats
        .athlete_results
        .iter()
        .map(|row| {
            let cells = athlete_cells(row)
                .into_iter()
                .map(|cell| view! { <td>{cell}</td> })
                .collect_view();
            view! { <tr>{cells}</tr> }
        })
        .collect_view();
    view! { <div class="data-metric-grid">{metrics}</div>
    <DataTable><TableHead headers=&ATHLETE_HEADERS /><tbody>{is_empty.then(|| view! { <EmptyTableRow columns=ATHLETE_HEADERS.len() message="No club results were found for this meet." /> })}{rows}</tbody></DataTable> }.into_any()
}

const ATHLETE_COLUMNS: usize = 11;

const ATHLETE_HEADERS: [&str; ATHLETE_COLUMNS] = [
    "Athlete",
    "Class",
    "Bodyweight",
    "Snatch",
    "Snatch medal",
    "C&J",
    "C&J medal",
    "Total",
    "Total medal",
    "PR",
    "6 for 6",
];

fn athlete_cells(row: &AthleteResult) -> [String; ATHLETE_COLUMNS] {
    [
        row.name.clone(),
        display_weight_class(&row.weight_class),
        display_body_weight(row.body_weight),
        row.snatch_best.to_string(),
        medal(&row.snatch_medal),
        row.cj_best.to_string(),
        medal(&row.cj_medal),
        row.total.to_string(),
        medal(&row.total_medal),
        yes_no(row.is_pr).to_owned(),
        yes_no(row.perfect_lifts).to_owned(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::api::{queries, wire, wire_fixture};

    #[test]
    fn a_clubs_meets_and_stats_read_the_servers_answers() {
        let meets: Vec<ClubMeets> =
            wire::read(queries::CLUB_MEETS, wire_fixture!("reference.clubMeets"));
        let results: Vec<_> = meets
            .iter()
            .flat_map(|answer| answer.meets.iter().map(|meet| meet.has_results))
            .collect();
        assert_eq!(results, [false, true]);
        let stats: Vec<MeetStats> = wire::read(
            queries::CLUB_MEET_STATS,
            wire_fixture!("reference.clubMeetStats"),
        );
        let athletes: Vec<_> = stats.iter().map(|stats| stats.total_athletes).collect();
        assert_eq!(athletes, [3]);
    }

    #[test]
    fn stats_payload_deserializes() {
        let stats: MeetStats = serde_json::from_str(r#"{"total_athletes":1,"gold_medals":1,"silver_medals":0,"bronze_medals":0,"total_prs":1,"perfect_6_for_6":1,"total_weight_lifted":225.0,"snatch_make_rate":100,"cj_make_rate":100,"combined_make_rate":100,"athlete_results":[]}"#).unwrap();
        assert_eq!(stats.total_athletes, 1);
    }

    fn athlete(weight_class: &str, body_weight: f64) -> AthleteResult {
        AthleteResult {
            name: "Test Athlete".to_owned(),
            weight_class: weight_class.to_owned(),
            snatch_best: 100.0,
            cj_best: 125.0,
            total: 225.0,
            body_weight,
            snatch_medal: Some("gold".to_owned()),
            cj_medal: None,
            total_medal: Some("silver".to_owned()),
            is_pr: true,
            perfect_lifts: false,
        }
    }

    #[test]
    fn a_row_shows_the_rosters_class_with_its_unit_as_the_other_tables_do() {
        assert_eq!(athlete_cells(&athlete("69", 68.4))[1], "69kg");
        assert_eq!(athlete_cells(&athlete("+110", 121.0))[1], "110+kg");
        assert_eq!(athlete_cells(&athlete("69kg", 68.4))[1], "69kg");
    }

    #[test]
    fn a_row_shows_a_dash_for_a_body_weight_that_was_not_recorded() {
        assert_eq!(athlete_cells(&athlete("69", 0.0))[2], "—");
        assert_eq!(
            athlete_cells(&athlete("69", 68.4)),
            [
                "Test Athlete",
                "69kg",
                "68.4",
                "100",
                "Gold",
                "125",
                "—",
                "225",
                "Silver",
                "Yes",
                "No"
            ]
        );
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
        let choices = club_meet_choices(answer);
        assert_eq!(
            choices.meets,
            ["Zephyr Classic", "Arnold Open", "Undated Open"]
        );
        assert!(!choices.truncated);
    }

    #[test]
    fn a_cut_short_answer_says_so_and_one_that_does_not_say_is_unreadable() {
        let cut: ClubMeets = serde_json::from_str(
            r#"{"meets":[{"meet":"Arnold Open","has_results":true}],"truncated":true}"#,
        )
        .unwrap();
        assert!(club_meet_choices(cut).truncated);
        let answer_without_truncated = r#"{"meets":[{"meet":"Arnold Open","has_results":true}]}"#;
        assert!(serde_json::from_str::<ClubMeets>(answer_without_truncated).is_err());
    }
}
