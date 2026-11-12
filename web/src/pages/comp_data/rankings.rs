use super::{
    filters::{
        ClassificationFilters, ClassifiedRow, SortDirection, classified_rows, filter_options,
        sort_numeric, sort_orders, weight_class_options,
    },
    format::display_weight_class,
    loading::{load_rows, table_response},
    ui::{DataPage, DataTable, EmptyTableRow, FilterSelect, SortSelect},
};
use crate::utils::api::queries;
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

impl Ranking {
    /// The ranking with its class as every table writes it (`65` → `65kg`).
    fn shown(self) -> Self {
        Self {
            weight_class: display_weight_class(&self.weight_class),
            ..self
        }
    }
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

sort_orders!(RankingSort {
    RankAsc => ("rank_asc", "Rank: low to high"),
    RankDesc => ("rank_desc", "Rank: high to low"),
    PercentADesc => ("percent_a_desc", "Percent A: high to low"),
    PercentAAsc => ("percent_a_asc", "Percent A: low to high"),
    TotalDesc => ("total_desc", "Total: high to low"),
    TotalAsc => ("total_asc", "Total: low to high"),
});

#[component]
pub fn Rankings() -> impl IntoView {
    let (meet, set_meet) = signal(String::new());
    let (gender, set_gender) = signal(String::new());
    let (age, set_age) = signal(String::new());
    let (weight_class, set_weight_class) = signal(String::new());
    let (sort, set_sort) = signal(RankingSort::RankAsc);
    let rankings = load_rows(queries::INTL_RANKINGS, Ranking::shown);

    view! {
        <DataPage
            heading="International Rankings"
            intro="Browse current international rankings by meet, gender, age, or weight class."
        >
            {move || table_response(rankings, 8, "rankings", |rankings| {
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

                match sort.get() {
                    RankingSort::RankDesc => sort_numeric(&mut filtered_rankings, |row| row.ranking, SortDirection::Descending),
                    RankingSort::PercentADesc => sort_numeric(&mut filtered_rankings, |row| row.percent_a, SortDirection::Descending),
                    RankingSort::PercentAAsc => sort_numeric(&mut filtered_rankings, |row| row.percent_a, SortDirection::Ascending),
                    RankingSort::TotalDesc => sort_numeric(&mut filtered_rankings, |row| row.total, SortDirection::Descending),
                    RankingSort::TotalAsc => sort_numeric(&mut filtered_rankings, |row| row.total, SortDirection::Ascending),
                    RankingSort::RankAsc => sort_numeric(&mut filtered_rankings, |row| row.ranking, SortDirection::Ascending),
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
                        <FilterSelect label="Meet" placeholder="All meets" values=meets selected=meet on_select=move |value| set_meet.set(value) />
                        <FilterSelect label="Gender" placeholder="All genders" values=genders selected=gender on_select=move |value| set_gender.set(value) />
                        <FilterSelect label="Age" placeholder="All ages" values=ages selected=age on_select=move |value| set_age.set(value) />
                        <FilterSelect label="Weight class" placeholder="All classes" values=weights selected=weight_class on_select=move |value| set_weight_class.set(value) />
                        <SortSelect sort set_sort />
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
            })}
        </DataPage>
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::api::{queries, wire, wire_fixture};

    #[test]
    fn rankings_read_the_servers_answer() {
        let answers: Vec<Vec<Ranking>> = wire::read(
            queries::INTL_RANKINGS,
            wire_fixture!("reference.intlRankings"),
        );
        let percent: Vec<_> = answers.iter().flatten().map(|row| row.percent_a).collect();
        assert_eq!(percent, [104.5]);
    }

    #[test]
    fn international_ranking_deserializes_from_the_api_shape() {
        let ranking: Ranking = serde_json::from_str(
            r#"{"meet":"World Championships","ranking":2.0,"name":"Test Athlete","weight_class":"88kg","total":350.0,"percent_a":97.4,"gender":"Men","age_category":"Senior"}"#,
        )
        .unwrap();

        assert_eq!(ranking.ranking, 2.0);
        assert_eq!(ranking.percent_a, 97.4);
    }

    #[test]
    fn every_sort_order_in_the_menu_is_one_the_table_sorts_by() {
        crate::pages::comp_data::filters::assert_each_sort_order_parses_to_itself::<RankingSort>();
    }
}
