use super::{
    address::{HistoryEntry, query_param, use_page_address},
    catalog,
    filters::{SortDirection, sort_numeric},
    format::{GENDERS, NO_VALUE, format_us_date},
    loading::{Load, LoadState, load_error},
    ui::{DataPage, DataStatus, SelectOptions, StaticRowsTable, TableSkeleton},
};
use crate::utils::api::{queries, query_with};
use leptos::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize)]
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
    let page = use_page_address("/national-rankings");
    let federation_in_address = query_param("federation");
    let division_in_address = query_param("division");
    let year_in_address = query_param("year");
    let request = Memo::new(move |_| {
        ranking_request(
            &federation_in_address.get(),
            &division_in_address.get(),
            &year_in_address.get(),
        )
    });

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
            page=catalog::NATIONAL_RANKINGS
        >
            <NationalRankingsForm
                shown=request
                submit=Callback::new(move |query: NationalRankingQuery| {
                    if request.get_untracked().as_ref() == Some(&query) {
                        rankings.retry();
                    } else {
                        page.show(
                            &[
                                ("federation", &query.federation),
                                ("division", &query.age_category),
                                ("year", query.year.as_deref().unwrap_or_default()),
                            ],
                            HistoryEntry::Push,
                        );
                    }
                })
            />
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

const YEAR_DIGITS: usize = 4;
const YEAR_PROBLEM: &str = "Enter a four-digit year, or leave it blank for all-time rankings.";

fn ranking_year(typed: &str) -> Result<Option<String>, &'static str> {
    let year = typed.trim();
    if year.is_empty() {
        Ok(None)
    } else if year.len() == YEAR_DIGITS && year.bytes().all(|byte| byte.is_ascii_digit()) {
        Ok(Some(year.to_owned()))
    } else {
        Err(YEAR_PROBLEM)
    }
}

const DEFAULT_FEDERATION: &str = "USAW";
const DEFAULT_GENDER: &str = "Men";
const DEFAULT_AGE_GROUP: &str = "Senior";
const DEFAULT_DIVISION: &str = "Open Men's 60kg";
const FEDERATIONS: [&str; 2] = ["USAW", "USAMW"];

fn ranking_request(federation: &str, division: &str, year: &str) -> Option<NationalRankingQuery> {
    if division.is_empty() {
        return None;
    }
    Some(NationalRankingQuery {
        federation: if federation.is_empty() {
            DEFAULT_FEDERATION.to_owned()
        } else {
            federation.to_owned()
        },
        age_category: division.to_owned(),
        year: ranking_year(year).ok()?,
    })
}

fn gender_and_age_group_of(division: &str) -> Option<(&'static str, &'static str)> {
    GENDERS.into_iter().find_map(|gender| {
        AGE_GROUPS
            .iter()
            .find(|age_group| {
                division_options(gender, age_group)
                    .iter()
                    .any(|option| option == division)
            })
            .map(|age_group| (gender, *age_group))
    })
}

fn owned(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

struct FormChoices {
    federation: String,
    gender: String,
    age_group: String,
    division: String,
    year: String,
}

fn form_choices(shown: Option<&NationalRankingQuery>) -> FormChoices {
    let Some(shown) = shown else {
        return FormChoices {
            federation: DEFAULT_FEDERATION.to_owned(),
            gender: DEFAULT_GENDER.to_owned(),
            age_group: DEFAULT_AGE_GROUP.to_owned(),
            division: DEFAULT_DIVISION.to_owned(),
            year: String::new(),
        };
    };
    let (gender, age_group) =
        gender_and_age_group_of(&shown.age_category).unwrap_or((DEFAULT_GENDER, DEFAULT_AGE_GROUP));
    FormChoices {
        federation: shown.federation.clone(),
        gender: gender.to_owned(),
        age_group: age_group.to_owned(),
        division: shown.age_category.clone(),
        year: shown.year.clone().unwrap_or_default(),
    }
}

#[component]
fn NationalRankingsForm(
    shown: Memo<Option<NationalRankingQuery>>,
    submit: Callback<NationalRankingQuery>,
) -> impl IntoView {
    let first = shown.with_untracked(|shown| form_choices(shown.as_ref()));
    let first_federation = Some(first.federation.clone());
    let first_gender = Some(first.gender.clone());
    let first_age_group = Some(first.age_group.clone());
    let (federation, set_federation) = signal(first.federation);
    let (gender, set_gender) = signal(first.gender);
    let (age_group, set_age_group) = signal(first.age_group);
    let (division, set_division) = signal(first.division);
    let (year, set_year) = signal(first.year);
    let (year_problem, set_year_problem) = signal(None::<&'static str>);
    Effect::new(move |earlier: Option<()>| {
        let choices = shown.with(|shown| form_choices(shown.as_ref()));
        if earlier.is_some() {
            set_federation.set(choices.federation);
            set_gender.set(choices.gender);
            set_age_group.set(choices.age_group);
            set_division.set(choices.division);
            set_year.set(choices.year);
            set_year_problem.set(None);
        }
    });

    view! {
        <form class="data-query-form" on:submit=move |event| {
            event.prevent_default();
            let age_category = division.get().trim().to_owned();
            if !age_category.is_empty() {
                match ranking_year(&year.get()) {
                    Ok(year) => {
                        set_year_problem.set(None);
                        submit.run(NationalRankingQuery { federation: federation.get(), age_category, year });
                    }
                    Err(problem) => set_year_problem.set(Some(problem)),
                }
            }
        }>
            <label>"Federation"<select class="data-filter" prop:value=move || federation.get() on:change=move |event| set_federation.set(event_target_value(&event))><SelectOptions values=owned(&FEDERATIONS) selected=first_federation /></select></label>
            <label>"Gender"<select class="data-filter" prop:value=move || gender.get() on:change=move |event| { let selected = event_target_value(&event); let next = division_options(&selected, &age_group.get()).into_iter().next().unwrap_or_default(); set_gender.set(selected); set_division.set(next); }><SelectOptions values=owned(&GENDERS) selected=first_gender /></select></label>
            <label>"Age group"<select class="data-filter" prop:value=move || age_group.get() on:change=move |event| { let selected = event_target_value(&event); let next = division_options(&gender.get(), &selected).into_iter().next().unwrap_or_default(); set_age_group.set(selected); set_division.set(next); }><SelectOptions values=owned(AGE_GROUPS) selected=first_age_group /></select></label>
            <label class="data-query-grow">"Division"<select class="data-filter" required=true prop:value=move || division.get() on:change=move |event| set_division.set(event_target_value(&event))>{move || view! { <DivisionOptions groups=division_groups(&gender.get(), &age_group.get()) selected=division.get() /> }}</select></label>
            <label>"Year (optional)"<input class="data-filter data-year-input" inputmode="numeric" maxlength="4" placeholder="All time" prop:value=move || year.get() aria-invalid=move || year_problem.get().map(|_| "true") aria-describedby="national-rankings-year-problem" on:input=move |event| { set_year.set(event_target_value(&event)); set_year_problem.set(None); } /></label>
            <button class="data-search-button" type="submit">"View rankings"</button>
        </form>
        <p id="national-rankings-year-problem" class="data-status error" role="alert" hidden=move || year_problem.get().is_none()>
            {move || year_problem.get()}
        </p>
    }
}

/// Competition ranks for totals sorted highest first: a tie shares the rank
/// and the next total skips past it (250, 250, 240 rank 1, 1, 3).
fn competition_ranks(totals: &[f64]) -> Vec<usize> {
    let mut ranks = Vec::with_capacity(totals.len());
    let mut total_and_rank_before = None::<(f64, usize)>;
    for (index, total) in totals.iter().enumerate() {
        let rank = match total_and_rank_before {
            Some((total_before, rank_before)) if total_before == *total => rank_before,
            Some(_) | None => index + 1,
        };
        ranks.push(rank);
        total_and_rank_before = Some((*total, rank));
    }
    ranks
}

#[component]
fn NationalRankingsTable(rankings: Vec<NationalRanking>) -> impl IntoView {
    let mut ranked = rankings.iter().collect::<Vec<_>>();
    sort_numeric(&mut ranked, |row| row.total, SortDirection::Descending);
    let ranks = competition_ranks(&ranked.iter().map(|row| row.total).collect::<Vec<_>>());
    let rows = ranks
        .into_iter()
        .zip(ranked.into_iter().cloned())
        .collect::<Vec<_>>();
    view! { <StaticRowsTable headers=RANKING_HEADERS rows row=ranking_row empty_message="No rankings matched this federation and division." /> }
}

const RANKING_HEADERS: &[&str] = &["Rank", "Athlete", "Total", "Date"];

fn ranking_row((rank, row): &(usize, NationalRanking)) -> AnyView {
    view! { <tr><td>{*rank}</td><td>{row.name.clone()}</td><td>{row.total}</td><td>{row.date.as_deref().map_or_else(|| NO_VALUE.to_owned(), format_us_date)}</td></tr> }.into_any()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::api::{queries, wire, wire_fixture};

    #[test]
    fn national_rankings_read_the_servers_answers() {
        let all_time: Vec<Vec<NationalRanking>> = wire::read(
            queries::NATIONAL_RANKINGS,
            wire_fixture!("reference.nationalRankings"),
        );
        assert!(all_time.iter().flatten().all(|row| row.date.is_none()));
        let by_year: Vec<Vec<NationalRanking>> = wire::read(
            queries::NATIONAL_RANKINGS_BY_YEAR,
            wire_fixture!("reference.nationalRankingsByYear"),
        );
        assert!(by_year.iter().flatten().all(|row| row.date.is_some()));
    }

    #[test]
    fn a_year_is_four_digits_or_blank_as_the_server_requires() {
        assert_eq!(ranking_year(""), Ok(None));
        assert_eq!(ranking_year("   "), Ok(None));
        assert_eq!(ranking_year("2026"), Ok(Some("2026".to_owned())));
        assert_eq!(ranking_year(" 2026 "), Ok(Some("2026".to_owned())));
        for typed in ["26", "202", "abcd", "20 6", "20.6", "２０２６", "-202"] {
            assert_eq!(ranking_year(typed), Err(YEAR_PROBLEM), "{typed}");
        }
    }

    #[test]
    fn an_address_names_the_ranking_it_opens() {
        assert_eq!(ranking_request("USAW", "", "2026"), None);
        assert_eq!(
            ranking_request("", "Open Men's 60kg", ""),
            Some(NationalRankingQuery {
                federation: "USAW".to_owned(),
                age_category: "Open Men's 60kg".to_owned(),
                year: None
            })
        );
        assert_eq!(
            ranking_request("USAMW", "Women's Masters (40-44) 69kg", "2026"),
            Some(NationalRankingQuery {
                federation: "USAMW".to_owned(),
                age_category: "Women's Masters (40-44) 69kg".to_owned(),
                year: Some("2026".to_owned())
            })
        );
        assert_eq!(ranking_request("USAW", "Open Men's 60kg", "26"), None);
    }

    #[test]
    fn the_form_shows_the_gender_and_age_group_of_the_addresss_division() {
        assert_eq!(
            gender_and_age_group_of("Women's Masters (40-44) 69kg"),
            Some(("Women", "Masters 40"))
        );
        assert_eq!(
            gender_and_age_group_of("Open Men's 60kg"),
            Some(("Men", "Senior"))
        );
        assert_eq!(gender_and_age_group_of("Open Men's 85 kg"), None);
        let choices = form_choices(
            ranking_request("USAMW", "Women's 13 Under Age Group 30kg", "2025").as_ref(),
        );
        assert_eq!(
            (
                choices.federation.as_str(),
                choices.gender.as_str(),
                choices.age_group.as_str(),
                choices.year.as_str()
            ),
            ("USAMW", "Women", "U13", "2025")
        );
        let untouched = form_choices(None);
        assert_eq!(
            (untouched.federation.as_str(), untouched.division.as_str()),
            ("USAW", "Open Men's 60kg")
        );
    }

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
    fn tied_totals_share_a_rank() {
        assert_eq!(
            competition_ranks(&[330.0, 325.0, 325.0, 306.0, 305.0, 305.0, 305.0, 302.0]),
            [1, 2, 2, 4, 5, 5, 5, 8]
        );
        assert_eq!(competition_ranks(&[]), Vec::<usize>::new());
        assert_eq!(competition_ranks(&[200.0]), [1]);
    }

    #[test]
    fn ranking_accepts_a_missing_date() {
        let ranking: NationalRanking =
            serde_json::from_str(r#"{"name":"Test Athlete","total":245.0,"date":null}"#).unwrap();

        assert_eq!(ranking.name, "Test Athlete");
        assert_eq!(ranking.date, None);
    }
}
