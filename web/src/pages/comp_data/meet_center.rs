use super::{
    address::{HistoryEntry, query_param, use_page_address},
    catalog,
    combobox::{Combobox, SuggestionCopy, Suggestions},
    format::{
        NO_VALUE, display_body_weight, display_gender, display_weight_class, format_us_date,
        format_us_time, yes_no,
    },
    loading::{Load, load_meet_data, select_response, table_response},
    meets::load_meet_catalog,
    models::{Athlete, LiftingResult, Meet, ScheduleRow, attempt},
    results::results_url,
    ui::{DataPage, DataStatus, StaticRowsTable},
};
use crate::utils::api::queries;
use leptos::prelude::*;

fn session(value: Option<f64>) -> String {
    value
        .map(|value| {
            if value.fract() == 0.0 {
                format!("{value:.0}")
            } else {
                value.to_string()
            }
        })
        .unwrap_or_else(|| NO_VALUE.to_owned())
}

/// Apostrophes meet names are written with (typewriter, curly, modifier
/// letter, accents used in their place): dropped by `fold_meet_search`.
const APOSTROPHES: [char; 7] = [
    '\'', '\u{2019}', '\u{2018}', '\u{02bc}', '\u{00b4}', '`', '\u{2032}',
];

/// A meet name or query folded for matching: lowercase, apostrophes dropped
/// (so "masters" finds "Master's"), and each run of whitespace, a
/// non-breaking space included, one space (so "2026 IMWA" finds
/// "2026\u{a0}IMWA").
fn fold_meet_search(value: &str) -> String {
    value
        .chars()
        .filter(|ch| !APOSTROPHES.contains(ch))
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn folded_names(meets: &[Meet]) -> Vec<String> {
    meets
        .iter()
        .map(|row| fold_meet_search(&row.name))
        .collect()
}

fn meet_suggestions(meets: &[Meet], folded: &[String], query: &str, limit: usize) -> Vec<String> {
    if query.trim().chars().count() < 3 {
        return Vec::new();
    }
    let query = fold_meet_search(query);
    if query.is_empty() {
        return Vec::new();
    }
    meets
        .iter()
        .zip(folded)
        .filter(|(_, name)| name.contains(&query))
        .take(limit)
        .map(|(row, _)| row.name.clone())
        .collect()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MeetSection {
    Schedule,
    StartList,
    Results,
}

const SECTION_PARAM: &str = "section";

impl MeetSection {
    const ALL: [MeetSection; 3] = [Self::Schedule, Self::StartList, Self::Results];

    fn value(self) -> &'static str {
        match self {
            Self::Schedule => "",
            Self::StartList => "start-list",
            Self::Results => "results",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Schedule => "Schedule",
            Self::StartList => "Start List",
            Self::Results => "Full Results",
        }
    }

    fn in_address(value: &str) -> Self {
        Self::ALL
            .into_iter()
            .find(|section| section.value() == value)
            .unwrap_or(Self::Schedule)
    }
}

#[component]
pub fn MeetCenter() -> impl IntoView {
    let page = use_page_address("/meet-center");
    let meet = query_param("meet");
    let section_in_address = query_param(SECTION_PARAM);
    let section =
        Memo::new(move |_| section_in_address.with(|value| MeetSection::in_address(value)));
    let (meet_search, set_meet_search) = signal(meet.get_untracked());
    Effect::new(move |shown_before: Option<String>| {
        let shown = meet.get();
        if let Some(shown_before) = shown_before {
            if !shown.is_empty() {
                set_meet_search.set(shown.clone());
            } else if meet_search.get_untracked() == shown_before {
                set_meet_search.set(String::new());
            }
        }
        shown
    });
    let show_meet = Callback::new(move |(name, entry): (String, HistoryEntry)| {
        page.show(
            &[
                ("meet", &name),
                (SECTION_PARAM, section.get_untracked().value()),
            ],
            entry,
        );
    });
    let meets = load_meet_catalog();
    let schedule = Load::new(
        move || meet.get(),
        |meet| load_meet_data::<ScheduleRow>(meet, queries::MEET_SCHEDULE),
    );
    let athletes = Load::new(
        move || meet.get(),
        // The plain roster, one row per athlete: the session join repeats an
        // athlete once per schedule row of their session, and this table
        // shows none of the joined fields.
        |meet| load_meet_data::<Athlete>(meet, queries::MEET_ATHLETES),
    );
    let results = Load::new(
        move || meet.get(),
        |meet| load_meet_data::<LiftingResult>(meet, queries::MEET_RESULTS),
    );

    view! {
        <DataPage
            page=catalog::MEET_CENTER
        >
            {move || select_response(meets, "Loading meets…", "meets", |meets| {
                view! { <MeetPicker meets=meets.to_vec() meet show_meet meet_search set_meet_search /> }.into_any()
            })}

            {move || if meet.get().is_empty() { view! { <DataStatus message="Search for and select a meet to load its competition data." /> }.into_any() } else { view! {
                <div class="data-tabs" role="group" aria-label="Meet data">
                    {MeetSection::ALL.into_iter().map(|choice| view! {
                        <button
                            type="button"
                            class="data-tab"
                            aria-pressed=move || if section.get() == choice { "true" } else { "false" }
                            on:click=move |_| page.change(&[(SECTION_PARAM, choice.value())], HistoryEntry::Replace)
                        >
                            {choice.label()}
                        </button>
                    }).collect_view()}
                </div>
                <div role="region" aria-label=move || section.get().label()>
                    {move || match section.get() {
                        MeetSection::Schedule => table_response(schedule, SCHEDULE_HEADERS.len(), "schedule", table_schedule),
                        MeetSection::StartList => table_response(athletes, START_LIST_HEADERS.len(), "start list", table_athletes),
                        MeetSection::Results => table_response(results, RESULTS_HEADERS.len(), "meet results", table_results),
                    }}
                </div>
            }.into_any() }}
        </DataPage>
    }
}

#[component]
fn MeetPicker(
    meets: Vec<Meet>,
    meet: Memo<String>,
    show_meet: Callback<(String, HistoryEntry)>,
    meet_search: ReadSignal<String>,
    set_meet_search: WriteSignal<String>,
) -> impl IntoView {
    let folded = StoredValue::new(folded_names(&meets));
    let meets = StoredValue::new(meets);
    view! {
        <Combobox
                input_id="meet-search-input"
                label="Meet"
                placeholder="Type at least 3 characters"
                input_class="data-filter data-filter-wide"
                wrapper_class="meet-search"
                list_class="meet-suggestions"
                value=meet_search
                suggestions=Signal::derive(move || {
                    let query = meet_search.get();
                    if !meet.get().is_empty() || query.trim().chars().count() < 3 {
                        return Suggestions::Idle;
                    }
                    Suggestions::Ready(meets.with_value(|meets| folded.with_value(|folded| meet_suggestions(meets, folded, &query, 8))))
                })
                copy=SuggestionCopy {
                    list_label: "Meet suggestions",
                    no_matches: "No matching meets",
                    failed: "Couldn’t load meets",
                }
                on_input=move |value: String| {
                    set_meet_search.set(value.clone());
                    if !meet.get_untracked().is_empty() && meet.get_untracked() != value {
                        show_meet.run((String::new(), HistoryEntry::Replace));
                    }
                }
                on_select=move |name: String| {
                    set_meet_search.set(name.clone());
                    show_meet.run((name, HistoryEntry::Push));
                }
                on_dismiss=|()| {}
            />
        {move || meets.with_value(|meets| meets.iter().find(|row| row.name == meet.get()).cloned()).map(|row| view! {
            <article class="meet-summary"><div><span class="data-badge">{row.status}</span><h2>{row.name}</h2>
            <p>{format!("{} – {} · {}", format_us_date(&row.start_date), format_us_date(&row.end_date), row.time_zone)}</p>
            <p>{format!("{}, {} · {}, {} {}", row.venue_name, row.venue_street, row.venue_city, row.venue_state, row.venue_zip)}</p></div>
            <div class="meet-links">{row.venue_map_apple_url.map(|url| view! { <a href=url target="_blank" rel="noopener noreferrer">"Open venue map"</a> })}{row.venue_map_pdf_url.map(|url| view! { <a href=url target="_blank" rel="noopener noreferrer">"Venue PDF"</a> })}</div></article>
        })}
    }
}

const SCHEDULE_HEADERS: &[&str] = &[
    "Date",
    "Session",
    "Platform",
    "Weight class",
    "Weigh-in",
    "Start",
];

const START_LIST_HEADERS: &[&str] = &[
    "Athlete",
    "Gender",
    "Age",
    "Weight class",
    "Entry total",
    "Club",
    "WSO",
    "Session",
    "Platform",
    "Adaptive",
];

const RESULTS_HEADERS: &[&str] = &[
    "Athlete",
    "Total",
    "Division",
    "Bodyweight",
    "S1",
    "S2",
    "S3",
    "Best snatch",
    "C&J 1",
    "C&J 2",
    "C&J 3",
    "Best C&J",
    "Adaptive",
];

fn schedule_row(row: &ScheduleRow) -> AnyView {
    view! { <tr><td>{format_us_date(&row.date)}</td><td>{session(Some(row.session_id))}</td><td>{row.platform.clone()}</td><td>{row.weight_class.clone()}</td><td>{format_us_time(&row.weigh_in_time)}</td><td>{format_us_time(&row.start_time)}</td></tr> }.into_any()
}

fn athlete_row(row: &Athlete) -> AnyView {
    view! { <tr><td>{row.name.clone()}</td><td>{display_gender(&row.gender)}</td><td>{row.age}</td><td>{display_weight_class(&row.weight_class)}</td><td>{row.entry_total}</td><td>{row.club.clone()}</td><td>{row.wso.clone().unwrap_or_else(|| NO_VALUE.to_owned())}</td><td>{session(row.session_number)}</td><td>{row.session_platform.clone().unwrap_or_else(|| NO_VALUE.to_owned())}</td><td>{yes_no(row.adaptive)}</td></tr> }.into_any()
}

fn result_row(row: &LiftingResult) -> AnyView {
    let athlete_url = results_url(&row.name);
    view! { <tr><td><a class="data-athlete-link" href=athlete_url>{row.name.clone()}</a></td><td><strong>{row.total}</strong></td><td>{row.age.clone()}</td><td>{display_body_weight(row.body_weight)}</td><td>{attempt(row.snatch1)}</td><td>{attempt(row.snatch2)}</td><td>{attempt(row.snatch3)}</td><td>{row.snatch_best}</td><td>{attempt(row.cj1)}</td><td>{attempt(row.cj2)}</td><td>{attempt(row.cj3)}</td><td>{row.cj_best}</td><td>{yes_no(row.adaptive)}</td></tr> }.into_any()
}

fn table_schedule(rows: &[ScheduleRow]) -> AnyView {
    view! { <StaticRowsTable headers=SCHEDULE_HEADERS rows=rows.to_vec() row=schedule_row empty_message="No schedule has been published for this meet." /> }.into_any()
}

fn table_athletes(rows: &[Athlete]) -> AnyView {
    view! { <StaticRowsTable headers=START_LIST_HEADERS rows=rows.to_vec() row=athlete_row empty_message="No start list has been published for this meet." /> }.into_any()
}

fn table_results(rows: &[LiftingResult]) -> AnyView {
    let mut rows = rows.to_vec();
    rows.sort_by(|left, right| right.total.total_cmp(&left.total));
    view! { <StaticRowsTable headers=RESULTS_HEADERS rows row=result_row empty_message="No results have been published for this meet." /> }.into_any()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meet(name: &str, start_date: &str) -> Meet {
        Meet {
            name: name.to_owned(),
            start_date: start_date.to_owned(),
            end_date: start_date.to_owned(),
            time_zone: "America/Los_Angeles".to_owned(),
            venue_city: String::new(),
            venue_name: String::new(),
            venue_state: String::new(),
            venue_street: String::new(),
            venue_zip: String::new(),
            status: "Published".to_owned(),
            venue_map_pdf_url: None,
            venue_map_apple_url: None,
        }
    }

    #[test]
    fn the_section_shown_is_the_one_in_the_address_or_the_schedule() {
        for section in MeetSection::ALL {
            assert_eq!(MeetSection::in_address(section.value()), section);
        }
        assert_eq!(MeetSection::in_address("standings"), MeetSection::Schedule);
        assert_eq!(MeetSection::Schedule.value(), "");
    }

    #[test]
    fn absent_sessions_use_dash() {
        assert_eq!(session(None), "—");
        assert_eq!(session(Some(3.0)), "3");
    }

    #[test]
    fn meet_suggestions_require_three_characters_and_are_limited() {
        let meets = [
            meet("National Championships", "2026-01-01"),
            meet("National Open", "2025-01-01"),
        ];
        assert!(meet_suggestions(&meets, &folded_names(&meets), "na", 8).is_empty());
        assert_eq!(
            meet_suggestions(&meets, &folded_names(&meets), "nat", 1),
            ["National Championships"]
        );
    }

    #[test]
    fn meet_suggestions_fold_spaces_and_apostrophes() {
        let meets = [
            meet(
                "2026\u{a0}IMWA WORLD MASTERS WEIGHTLIFTING CHAMPIONSHIP",
                "2026-10-01",
            ),
            meet("USAW Master\u{2019}s Nationals", "2026-03-01"),
            meet("USAMW Master's Nationals", "2026-04-01"),
        ];
        assert_eq!(
            meet_suggestions(&meets, &folded_names(&meets), "2026 IMWA", 8),
            ["2026\u{a0}IMWA WORLD MASTERS WEIGHTLIFTING CHAMPIONSHIP"]
        );
        assert_eq!(
            meet_suggestions(&meets, &folded_names(&meets), "masters  nationals", 8),
            ["USAW Master\u{2019}s Nationals", "USAMW Master's Nationals"]
        );
        assert_eq!(
            meet_suggestions(&meets, &folded_names(&meets), "master\u{2019}s", 8).len(),
            3
        );
    }

    #[test]
    fn meet_suggestions_count_a_short_query_as_typed() {
        let meets = [
            meet("A's Open", "2026-01-01"),
            meet("Bass Classic", "2025-01-01"),
        ];
        assert_eq!(
            meet_suggestions(&meets, &folded_names(&meets), "A's", 8),
            ["A's Open", "Bass Classic"]
        );
        assert_eq!(
            meet_suggestions(&meets, &folded_names(&meets), "A\u{2019}s", 8).len(),
            2
        );
        assert!(meet_suggestions(&meets, &folded_names(&meets), "'''", 8).is_empty());
        assert!(meet_suggestions(&meets, &folded_names(&meets), "A'", 8).is_empty());
    }
}
