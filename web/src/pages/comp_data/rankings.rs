use super::{
    filters::{
        ClassificationFilters, ClassifiedRow, SortDirection, classified_rows, filter_options,
        sort_numeric, weight_class_options,
    },
    loading::table_response,
    ui::{DataPage, DataTable, EmptyTableRow, FilterSelect, SortSelect},
};
use crate::utils::api::get_api_response;
use leptos::prelude::*;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct Ranking {
    meet: String,
    ranking: f64,
    name: String,
    weight_class: String,
    total: f64,
    percent_a: f64,
    gender: String,
    age_category: String,
}

impl ClassifiedRow for Ranking {
    fn gender(&self) -> &str {
        &self.gender
    }
    fn age_category(&self) -> &str {
        &self.age_category
    }
    fn weight_class(&self) -> &str {
        &self.weight_class
    }
}

const SORT_OPTIONS: &[(&str, &str)] = &[
    ("rank_asc", "Rank: low to high"),
    ("rank_desc", "Rank: high to low"),
    ("percent_a_desc", "Percent A: high to low"),
    ("percent_a_asc", "Percent A: low to high"),
    ("total_desc", "Total: high to low"),
    ("total_asc", "Total: low to high"),
];

#[component]
pub fn Rankings() -> impl IntoView {
    let (meet, set_meet) = signal(String::new());
    let (gender, set_gender) = signal(String::new());
    let (age, set_age) = signal(String::new());
    let (weight_class, set_weight_class) = signal(String::new());
    let (sort, set_sort) = signal("rank_asc".to_string());
    let rankings =
        LocalResource::new(|| async { get_api_response::<Ranking>("/data/intl-rankings").await });

    view! {
        <DataPage
            heading="International Rankings"
            intro="Search current international rankings by athlete, meet, division, or weight class."
        >
            {move || rankings.with(|response| table_response(response, 8, "rankings", |rankings| {
                let meets = filter_options(rankings.iter().map(|ranking| ranking.meet.as_str()));
                let genders = filter_options(rankings.iter().map(|ranking| ranking.gender.as_str()));
                let ages = filter_options(rankings.iter().map(|ranking| ranking.age_category.as_str()));
                let weights = weight_class_options(rankings.iter().map(|ranking| ranking.weight_class.as_str()));
                let selected_meet = meet.get();
                let selected_gender = gender.get();
                let selected_age = age.get();
                let selected_weight = weight_class.get();
                let filters = ClassificationFilters { gender: &selected_gender, age_category: &selected_age, weight_class: &selected_weight };
                let mut filtered_rankings = classified_rows(rankings, &filters, |ranking| {
                    selected_meet.is_empty() || ranking.meet == selected_meet
                });

                match sort.get().as_str() {
                    "rank_desc" => sort_numeric(&mut filtered_rankings, |row| row.ranking, SortDirection::Descending),
                    "percent_a_desc" => sort_numeric(&mut filtered_rankings, |row| row.percent_a, SortDirection::Descending),
                    "percent_a_asc" => sort_numeric(&mut filtered_rankings, |row| row.percent_a, SortDirection::Ascending),
                    "total_desc" => sort_numeric(&mut filtered_rankings, |row| row.total, SortDirection::Descending),
                    "total_asc" => sort_numeric(&mut filtered_rankings, |row| row.total, SortDirection::Ascending),
                    _ => sort_numeric(&mut filtered_rankings, |row| row.ranking, SortDirection::Ascending),
                }
                let is_empty = filtered_rankings.is_empty();
                let rows = filtered_rankings
                    .into_iter()
                    .map(|ranking| view! {
                        <tr>
                            <td>{ranking.ranking}</td>
                            <td>{ranking.name.clone()}</td>
                            <td>{ranking.meet.clone()}</td>
                            <td>{ranking.gender.clone()}</td>
                            <td>{ranking.age_category.clone()}</td>
                            <td>{ranking.weight_class.clone()}</td>
                            <td>{ranking.total}</td>
                            <td>{ranking.percent_a}</td>
                        </tr>
                    })
                    .collect_view();

                view! {
                    <div class="data-filters">
                        <FilterSelect label="Meet" placeholder="All meets" values=meets selected=selected_meet on_select=move |value| set_meet.set(value) />
                        <FilterSelect label="Gender" placeholder="All genders" values=genders selected=selected_gender on_select=move |value| set_gender.set(value) />
                        <FilterSelect label="Age" placeholder="All ages" values=ages selected=selected_age on_select=move |value| set_age.set(value) />
                        <FilterSelect label="Weight class" placeholder="All classes" values=weights selected=selected_weight on_select=move |value| set_weight_class.set(value) />
                        <SortSelect options=SORT_OPTIONS set_sort />
                    </div>
                    <DataTable>
                        <thead>
                            <tr>
                                <th>"Rank"</th>
                                <th>"Athlete"</th>
                                <th>"Meet"</th>
                                <th>"Gender"</th>
                                <th>"Age"</th>
                                <th>"Weight class"</th>
                                <th>"Total"</th>
                                <th>"Percent A"</th>
                            </tr>
                        </thead>
                        <tbody>
                            {is_empty.then(|| view! { <EmptyTableRow columns=8 message="No rankings match these filters." /> })}
                            {rows}
                        </tbody>
                    </DataTable>
                }
                .into_any()
            }))}
        </DataPage>
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn international_ranking_deserializes_from_the_api_shape() {
        let ranking: Ranking = serde_json::from_str(
            r#"{"meet":"World Championships","ranking":2.0,"name":"Test Athlete","weight_class":"88kg","total":350.0,"percent_a":97.4,"gender":"Men","age_category":"Senior"}"#,
        )
        .unwrap();

        assert_eq!(ranking.ranking, 2.0);
        assert_eq!(ranking.percent_a, 97.4);
    }
}
