use super::{
    filters::{SortDirection, sort_numeric},
    loading::load_error,
    ui::{DataPage, DataStatus, DataTable, EmptyTableRow, SelectOptions, TableSkeleton},
};
use crate::utils::api::get_api_response_with_query;
use leptos::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
struct NationalRankingQuery {
    federation: String,
    age_category: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    year: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
struct NationalRanking {
    name: String,
    total: f64,
    date: Option<String>,
}

const AGE_GROUPS: &[&str] = &[
    "U11",
    "U13",
    "U15",
    "U17",
    "Junior",
    "Senior",
    "Masters 35",
    "Masters 40",
    "Masters 45",
    "Masters 50",
    "Masters 55",
    "Masters 60",
    "Masters 65",
    "Masters 70",
    "Masters 75",
    "Masters 80",
    "Masters 85",
    "Masters 90+",
];

fn division_options(gender: &str, age_group: &str) -> Vec<String> {
    let weights: &[&str] = match (gender, age_group) {
        ("Men", "U11" | "U13") => &[
            "40kg", "44kg", "48kg", "52kg", "56kg", "60kg", "65kg", "65+kg",
        ],
        ("Women", "U11" | "U13") => &[
            "36kg", "40kg", "44kg", "48kg", "53kg", "58kg", "63kg", "63+kg",
        ],
        ("Men", "U15") => &[
            "48kg", "52kg", "56kg", "60kg", "65kg", "71kg", "79kg", "79+kg",
        ],
        ("Women", "U15") => &[
            "40kg", "44kg", "48kg", "53kg", "58kg", "63kg", "69kg", "69+kg",
        ],
        ("Men", "U17") => &[
            "56kg", "60kg", "65kg", "71kg", "79kg", "88kg", "94kg", "94+kg",
        ],
        ("Women", "U17") => &[
            "44kg", "48kg", "53kg", "58kg", "63kg", "69kg", "77kg", "77+kg",
        ],
        ("Men", "Junior" | "Senior") => &[
            "60kg", "65kg", "71kg", "79kg", "88kg", "94kg", "110kg", "110+kg",
        ],
        ("Men", masters) if masters.starts_with("Masters ") => &[
            "60kg", "65kg", "71kg", "79kg", "88kg", "94kg", "110kg", "110+kg",
        ],
        ("Women", "Junior" | "Senior") => &[
            "48kg", "53kg", "58kg", "63kg", "69kg", "77kg", "86kg", "86+kg",
        ],
        ("Women", masters) if masters.starts_with("Masters ") => &[
            "48kg", "53kg", "58kg", "63kg", "69kg", "77kg", "86kg", "86+kg",
        ],
        _ => return Vec::new(),
    };

    let prefix = match age_group {
        "U11" => format!("{gender}'s 11 Under Age Group"),
        "U13" => format!("{gender}'s 13 Under Age Group"),
        "U15" => format!("{gender}'s 14-15 Age Group"),
        "U17" => format!("{gender}'s 16-17 Age Group"),
        "Junior" => format!("Junior {gender}'s"),
        "Senior" => format!("Open {gender}'s"),
        masters if masters.starts_with("Masters ") => {
            let start = masters.trim_start_matches("Masters ");
            let range = if start == "90+" {
                "90+".to_owned()
            } else {
                let lower = start.parse::<u32>().unwrap_or_default();
                format!("{lower}-{}", lower + 4)
            };
            format!("{gender}'s Masters ({range})")
        }
        _ => return Vec::new(),
    };

    weights
        .iter()
        .map(|weight| format!("{prefix} {weight}"))
        .collect()
}

#[component]
pub fn NationalRankings() -> impl IntoView {
    let (request, set_request) = signal(None::<NationalRankingQuery>);

    let rankings = LocalResource::new(move || {
        let request = request.get();
        async move {
            match request {
                Some(query) => {
                    let path = if query.year.is_some() {
                        "/data/nat-rankings-year"
                    } else {
                        "/data/nat-rankings"
                    };
                    get_api_response_with_query::<Vec<NationalRanking>, _>(path, &query)
                        .await
                        .map_err(|error| error.to_string())
                }
                None => Ok(Vec::new()),
            }
        }
    });

    view! {
        <DataPage
            heading="National Rankings"
            intro="Find each athlete’s best total for a USAW or USAMW division. Add a year to limit the rankings to that season."
        >
            <NationalRankingsForm set_request />
            <p class="data-help">"Division choices match the gender, age group, and weight classes used in the MeetCal app."</p>

            {move || rankings.with(|response| match response {
                None => view! { <TableSkeleton columns=4 /> }.into_any(),
                Some(Err(error)) => load_error("national rankings", error),
                Some(Ok(_)) if request.get().is_none() => view! {
                    <DataStatus message="Enter a division to view its national rankings." />
                }.into_any(),
                Some(Ok(rankings)) => view! { <NationalRankingsTable rankings=rankings.clone() /> }.into_any(),
            })}
        </DataPage>
    }
}

#[component]
fn NationalRankingsForm(set_request: WriteSignal<Option<NationalRankingQuery>>) -> impl IntoView {
    let (federation, set_federation) = signal("USAW".to_owned());
    let (gender, set_gender) = signal("Men".to_owned());
    let (age_group, set_age_group) = signal("Senior".to_owned());
    let (division, set_division) = signal("Open Men's 60kg".to_owned());
    let (year, set_year) = signal(String::new());

    view! {
        <form class="data-query-form" on:submit=move |event| {
            event.prevent_default();
            let age_category = division.get().trim().to_owned();
            if !age_category.is_empty() {
                let selected_year = year.get().trim().to_owned();
                set_request.set(Some(NationalRankingQuery { federation: federation.get(), age_category, year: (!selected_year.is_empty()).then_some(selected_year) }));
            }
        }>
            <label>"Federation"<select class="data-filter" on:change=move |event| set_federation.set(event_target_value(&event))><option value="USAW">"USAW"</option><option value="USAMW">"USAMW"</option></select></label>
            <label>"Gender"<select class="data-filter" on:change=move |event| { let selected = event_target_value(&event); let next = division_options(&selected, &age_group.get()).into_iter().next().unwrap_or_default(); set_gender.set(selected); set_division.set(next); }><option value="Men">"Men"</option><option value="Women">"Women"</option></select></label>
            <label>"Age group"<select class="data-filter" on:change=move |event| { let selected = event_target_value(&event); let next = division_options(&gender.get(), &selected).into_iter().next().unwrap_or_default(); set_age_group.set(selected); set_division.set(next); }>{AGE_GROUPS.iter().map(|age| view! { <option value=*age selected=*age == "Senior">{*age}</option> }).collect_view()}</select></label>
            <label class="data-query-grow">"Division"<select class="data-filter" required=true prop:value=move || division.get() on:change=move |event| set_division.set(event_target_value(&event))>{move || view! { <SelectOptions values=division_options(&gender.get(), &age_group.get()) selected=Some(division.get()) /> }}</select></label>
            <label>"Year (optional)"<input class="data-filter data-year-input" inputmode="numeric" maxlength="4" placeholder="All time" on:input=move |event| set_year.set(event_target_value(&event)) /></label>
            <button class="data-search-button" type="submit">"View rankings"</button>
        </form>
    }
}

#[component]
fn NationalRankingsTable(rankings: Vec<NationalRanking>) -> impl IntoView {
    let mut ranked = rankings.iter().collect::<Vec<_>>();
    sort_numeric(&mut ranked, |row| row.total, SortDirection::Descending);
    let rows = ranked.into_iter().enumerate().map(|(index, row)| view! { <tr><td>{index + 1}</td><td>{row.name.clone()}</td><td>{row.total}</td><td>{row.date.clone().unwrap_or_else(|| "—".to_owned())}</td></tr> }).collect_view();
    let empty = rankings.is_empty().then(|| view! { <EmptyTableRow columns=4 message="No rankings matched this federation and division." /> });
    view! { <DataTable><thead><tr><th>"Rank"</th><th>"Athlete"</th><th>"Total"</th><th>"Date"</th></tr></thead><tbody>{empty}{rows}</tbody></DataTable> }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_time_query_omits_the_year() {
        let query = serde_urlencoded::to_string(NationalRankingQuery {
            federation: "USAW".to_owned(),
            age_category: "Open Men's 60kg".to_owned(),
            year: None,
        })
        .unwrap();

        assert_eq!(query, "federation=USAW&age_category=Open+Men%27s+60kg");
    }

    #[test]
    fn seasonal_query_includes_the_year() {
        let query = serde_urlencoded::to_string(NationalRankingQuery {
            federation: "USAMW".to_owned(),
            age_category: "Women's Masters (40-44) 69kg".to_owned(),
            year: Some("2026".to_owned()),
        })
        .unwrap();

        assert!(query.contains("federation=USAMW"));
        assert!(query.contains("year=2026"));
    }

    #[test]
    fn division_options_match_the_mobile_app() {
        assert_eq!(
            division_options("Women", "Masters 40"),
            [
                "Women's Masters (40-44) 48kg",
                "Women's Masters (40-44) 53kg",
                "Women's Masters (40-44) 58kg",
                "Women's Masters (40-44) 63kg",
                "Women's Masters (40-44) 69kg",
                "Women's Masters (40-44) 77kg",
                "Women's Masters (40-44) 86kg",
                "Women's Masters (40-44) 86+kg",
            ]
        );
        assert_eq!(
            division_options("Men", "Senior")
                .first()
                .map(String::as_str),
            Some("Open Men's 60kg")
        );
    }

    #[test]
    fn ranking_accepts_a_missing_date() {
        let ranking: NationalRanking =
            serde_json::from_str(r#"{"name":"Test Athlete","total":245.0,"date":null}"#).unwrap();

        assert_eq!(ranking.name, "Test Athlete");
        assert_eq!(ranking.date, None);
    }
}
