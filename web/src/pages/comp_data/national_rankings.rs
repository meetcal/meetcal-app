use super::{
    filters::{SortDirection, sort_numeric},
    loading::{Load, LoadState, load_error},
    ui::{DataPage, DataStatus, DataTable, EmptyTableRow, SelectOptions, TableSkeleton},
};
use crate::utils::api::{queries, query_with};
use leptos::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
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

/// A USAW class set, by family: senior (Open, Junior and every Masters band),
/// 16-17, 14-15, and 13 & Under / 11 & Under, each as (men, women).
struct ClassEra {
    label: &'static str,
    senior: (&'static [&'static str], &'static [&'static str]),
    youth_16_17: (&'static [&'static str], &'static [&'static str]),
    youth_14_15: (&'static [&'static str], &'static [&'static str]),
    under_13: (&'static [&'static str], &'static [&'static str]),
}

/// USAW's weight classes, newest first: the app's `WEIGHT_CLASS_ERAS`
/// (`src/constants/weight-classes.ts`), which has the dates and sources.
/// `ranking_divisions.json`, written from the app, holds this to it.
const CLASS_ERAS: &[ClassEra] = &[
    ClassEra {
        label: "Current classes",
        senior: (
            &["60", "65", "70", "75", "85", "95", "110", "110+"],
            &["49", "53", "57", "61", "69", "77", "86", "86+"],
        ),
        youth_16_17: (
            &["55", "60", "65", "70", "75", "85", "95", "95+"],
            &["45", "49", "53", "57", "61", "69", "77", "77+"],
        ),
        youth_14_15: (
            &["50", "55", "60", "65", "70", "75", "85", "95", "95+"],
            &["45", "49", "53", "57", "61", "69", "77", "77+"],
        ),
        under_13: (
            &["32", "36", "40", "45", "50", "55", "60", "65", "70", "70+"],
            &["30", "33", "37", "41", "45", "49", "53", "57", "61", "61+"],
        ),
    },
    ClassEra {
        label: "2025 classes (before Aug 1, 2026)",
        senior: (
            &["60", "65", "71", "79", "88", "94", "110", "110+"],
            &["48", "53", "58", "63", "69", "77", "86", "86+"],
        ),
        youth_16_17: (
            &["56", "60", "65", "71", "79", "88", "94", "94+"],
            &["44", "48", "53", "58", "63", "69", "77", "77+"],
        ),
        youth_14_15: (
            &["48", "52", "56", "60", "65", "71", "79", "79+"],
            &["40", "44", "48", "53", "58", "63", "69", "69+"],
        ),
        under_13: (
            &["32", "36", "40", "44", "48", "52", "56", "60", "65", "65+"],
            &["30", "33", "36", "40", "44", "48", "53", "58", "63", "63+"],
        ),
    },
];

/// One era's divisions in the picker, under its heading.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(Deserialize))]
struct DivisionGroup {
    label: String,
    divisions: Vec<String>,
}

/// The division name before the class (`Open Men's`, `Women's Masters
/// (40-44)`), or `None` for an age group the picker does not know.
fn division_prefix(gender: &str, age_group: &str) -> Option<String> {
    let prefix = match age_group {
        "U11" => format!("{gender}'s 11 Under Age Group"),
        "U13" => format!("{gender}'s 13 Under Age Group"),
        "U15" => format!("{gender}'s 14-15 Age Group"),
        "U17" => format!("{gender}'s 16-17 Age Group"),
        "Junior" => format!("Junior {gender}'s"),
        "Senior" => format!("Open {gender}'s"),
        masters => {
            let start = masters.strip_prefix("Masters ")?;
            let range = if start == "90+" {
                "90+".to_owned()
            } else {
                let lower = start.parse::<u32>().ok()?;
                if !(35..=85).contains(&lower) || lower % 5 != 0 {
                    return None;
                }
                format!("{lower}-{}", lower + 4)
            };
            format!("{gender}'s Masters ({range})")
        }
    };
    Some(prefix)
}

/// An age group's divisions by era, current classes first; a retired era
/// lists only the classes the newer ones do not (`Open Men's 60kg` is one
/// ranking, listed once). The same groups as the app's `getWeightClassGroups`.
fn division_groups(gender: &str, age_group: &str) -> Vec<DivisionGroup> {
    let Some(prefix) = division_prefix(gender, age_group) else {
        return Vec::new();
    };
    let women = match gender {
        "Men" => false,
        "Women" => true,
        _ => return Vec::new(),
    };
    let mut listed = std::collections::HashSet::new();
    let mut groups = Vec::new();
    for era in CLASS_ERAS {
        let set = match age_group {
            "U11" | "U13" => era.under_13,
            "U15" => era.youth_14_15,
            "U17" => era.youth_16_17,
            _ => era.senior,
        };
        let weights = if women { set.1 } else { set.0 };
        let divisions: Vec<String> = weights
            .iter()
            .map(|weight| format!("{prefix} {weight}kg"))
            .filter(|division| listed.insert(division.clone()))
            .collect();
        if !divisions.is_empty() {
            groups.push(DivisionGroup {
                label: era.label.to_owned(),
                divisions,
            });
        }
    }
    groups
}

/// Every division the picker offers for an age group, current classes first.
fn division_options(gender: &str, age_group: &str) -> Vec<String> {
    division_groups(gender, age_group)
        .into_iter()
        .flat_map(|group| group.divisions)
        .collect()
}

#[component]
fn DivisionOptions(groups: Vec<DivisionGroup>, selected: String) -> impl IntoView {
    groups
        .into_iter()
        .map(|group| {
            view! {
                <optgroup label=group.label>
                    <SelectOptions values=group.divisions selected=Some(selected.clone()) />
                </optgroup>
            }
        })
        .collect_view()
}

#[component]
pub fn NationalRankings() -> impl IntoView {
    let (request, set_request) = signal(None::<NationalRankingQuery>);

    let rankings = Load::new(
        move || request.get(),
        |request| async move {
            let Some(query) = request else {
                return Ok(Vec::new());
            };
            let convex_query = if query.year.is_some() {
                queries::NATIONAL_RANKINGS_BY_YEAR
            } else {
                queries::NATIONAL_RANKINGS
            };
            query_with::<Vec<NationalRanking>, _>(convex_query, &query)
                .await
                .map_err(|error| error.to_string())
        },
    );

    view! {
        <DataPage
            heading="National Rankings"
            intro="Find each athlete’s best total for a USAW or USAMW division. Add a year to limit the rankings to that season."
        >
            <NationalRankingsForm submit=Callback::new(move |query| rankings.submit(|| set_request.set(Some(query)))) />
            <p class="data-help">"Division choices match the gender, age group, and weight classes used in the MeetCal app."</p>

            {move || if request.with(Option::is_none) {
                view! { <DataStatus message="Enter a division to view its national rankings." /> }.into_any()
            } else {
                rankings.with(|state| match state {
                    LoadState::Loading => view! { <TableSkeleton columns=4 /> }.into_any(),
                    LoadState::Failed(error) => load_error("national rankings", error, move || rankings.retry()),
                    LoadState::Ready(rankings) => view! { <NationalRankingsTable rankings=rankings.clone() /> }.into_any(),
                })
            }}
        </DataPage>
    }
}

#[component]
fn NationalRankingsForm(submit: Callback<NationalRankingQuery>) -> impl IntoView {
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
                submit.run(NationalRankingQuery { federation: federation.get(), age_category, year: (!selected_year.is_empty()).then_some(selected_year) });
            }
        }>
            <label>"Federation"<select class="data-filter" on:change=move |event| set_federation.set(event_target_value(&event))><option value="USAW">"USAW"</option><option value="USAMW">"USAMW"</option></select></label>
            <label>"Gender"<select class="data-filter" on:change=move |event| { let selected = event_target_value(&event); let next = division_options(&selected, &age_group.get()).into_iter().next().unwrap_or_default(); set_gender.set(selected); set_division.set(next); }><option value="Men">"Men"</option><option value="Women">"Women"</option></select></label>
            <label>"Age group"<select class="data-filter" on:change=move |event| { let selected = event_target_value(&event); let next = division_options(&gender.get(), &selected).into_iter().next().unwrap_or_default(); set_age_group.set(selected); set_division.set(next); }>{AGE_GROUPS.iter().map(|age| view! { <option value=*age selected=*age == "Senior">{*age}</option> }).collect_view()}</select></label>
            <label class="data-query-grow">"Division"<select class="data-filter" required=true prop:value=move || division.get() on:change=move |event| set_division.set(event_target_value(&event))>{move || view! { <DivisionOptions groups=division_groups(&gender.get(), &age_group.get()) selected=division.get() /> }}</select></label>
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
        let query = serde_json::to_value(NationalRankingQuery {
            federation: "USAW".to_owned(),
            age_category: "Open Men's 60kg".to_owned(),
            year: None,
        })
        .unwrap();

        assert_eq!(
            query,
            serde_json::json!({"federation": "USAW", "ageCategory": "Open Men's 60kg"})
        );
    }

    #[test]
    fn seasonal_query_includes_the_year() {
        let query = serde_json::to_value(NationalRankingQuery {
            federation: "USAMW".to_owned(),
            age_category: "Women's Masters (40-44) 69kg".to_owned(),
            year: Some("2026".to_owned()),
        })
        .unwrap();

        assert_eq!(query["federation"], "USAMW");
        assert_eq!(query["year"], "2026");
    }

    /// `ranking_divisions.json` is the app's picker (`rankingDivisionGroups`
    /// in `src/utils/nat-rankings.ts`, written by
    /// `scripts/write-ranking-divisions.ts`); the app's Jest suite holds the
    /// file to the app.
    #[test]
    fn division_options_match_the_mobile_app() {
        let app: std::collections::BTreeMap<
            String,
            std::collections::BTreeMap<String, Vec<DivisionGroup>>,
        > = serde_json::from_str(include_str!("ranking_divisions.json")).unwrap();

        for gender in ["Men", "Women"] {
            let by_age = &app[gender];
            assert_eq!(by_age.len(), AGE_GROUPS.len());
            for age_group in AGE_GROUPS {
                assert_eq!(
                    &division_groups(gender, age_group),
                    &by_age[*age_group],
                    "{gender} {age_group}"
                );
            }
        }
    }

    #[test]
    fn current_classes_come_first_and_retired_ones_stay_reachable() {
        let groups = division_groups("Men", "Senior");
        assert_eq!(groups[0].label, "Current classes");
        assert_eq!(groups[0].divisions[4], "Open Men's 85kg");
        assert_eq!(
            groups[1].divisions,
            [
                "Open Men's 71kg",
                "Open Men's 79kg",
                "Open Men's 88kg",
                "Open Men's 94kg"
            ]
        );
        assert_eq!(
            division_options("Men", "Senior")
                .first()
                .map(String::as_str),
            Some("Open Men's 60kg")
        );
        assert!(
            division_options("Women", "U13")
                .contains(&"Women's 13 Under Age Group 30kg".to_owned())
        );
        assert!(division_groups("Men", "Masters 37").is_empty());
    }

    #[test]
    fn ranking_accepts_a_missing_date() {
        let ranking: NationalRanking =
            serde_json::from_str(r#"{"name":"Test Athlete","total":245.0,"date":null}"#).unwrap();

        assert_eq!(ranking.name, "Test Athlete");
        assert_eq!(ranking.date, None);
    }
}
