use super::{
    filters::{SortDirection, sort_numeric, sort_orders},
    format::display_weight_class,
    loading::{load_rows, table_response},
    reference_table::{Filter, OptionOrder, ReferenceTable, TableSort},
    ui::DataPage,
};
use crate::utils::api::queries;
use leptos::prelude::*;
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
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
    fn shown(self) -> Self {
        Self {
            weight_class: display_weight_class(&self.weight_class),
            ..self
        }
    }
}

fn meet(ranking: &Ranking) -> &str {
    &ranking.meet
}

fn gender(ranking: &Ranking) -> &str {
    &ranking.gender
}

fn age(ranking: &Ranking) -> &str {
    &ranking.age_category
}

fn weight_class(ranking: &Ranking) -> &str {
    &ranking.weight_class
}

const FILTERS: &[Filter<Ranking>] = &[
    Filter {
        label: "Meet",
        placeholder: "All meets",
        value: meet,
        order: OptionOrder::Alphabetical,
    },
    Filter {
        label: "Gender",
        placeholder: "All genders",
        value: gender,
        order: OptionOrder::Alphabetical,
    },
    Filter {
        label: "Age",
        placeholder: "All ages",
        value: age,
        order: OptionOrder::Alphabetical,
    },
    Filter {
        label: "Weight class",
        placeholder: "All classes",
        value: weight_class,
        order: OptionOrder::ByWeight,
    },
];

const HEADERS: &[&str] = &[
    "Rank",
    "Athlete",
    "Meet",
    "Gender",
    "Age",
    "Weight class",
    "Total",
    "Percent A",
];

sort_orders!(RankingSort {
    RankAsc => ("rank_asc", "Rank: low to high"),
    RankDesc => ("rank_desc", "Rank: high to low"),
    PercentADesc => ("percent_a_desc", "Percent A: high to low"),
    PercentAAsc => ("percent_a_asc", "Percent A: low to high"),
    TotalDesc => ("total_desc", "Total: high to low"),
    TotalAsc => ("total_asc", "Total: low to high"),
});

impl TableSort<Ranking> for RankingSort {
    fn sort(self, rows: &mut [&Ranking]) {
        match self {
            RankingSort::RankDesc => {
                sort_numeric(rows, |row| row.ranking, SortDirection::Descending)
            }
            RankingSort::PercentADesc => {
                sort_numeric(rows, |row| row.percent_a, SortDirection::Descending)
            }
            RankingSort::PercentAAsc => {
                sort_numeric(rows, |row| row.percent_a, SortDirection::Ascending)
            }
            RankingSort::TotalDesc => {
                sort_numeric(rows, |row| row.total, SortDirection::Descending)
            }
            RankingSort::TotalAsc => sort_numeric(rows, |row| row.total, SortDirection::Ascending),
            RankingSort::RankAsc => sort_numeric(rows, |row| row.ranking, SortDirection::Ascending),
        }
    }
}

fn ranking_row(ranking: &Ranking) -> AnyView {
    view! {
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
    }
    .into_any()
}

#[component]
pub fn Rankings() -> impl IntoView {
    let sort = RwSignal::new(RankingSort::RankAsc);
    let rankings = load_rows(queries::INTL_RANKINGS, Ranking::shown);

    view! {
        <DataPage
            heading="International Rankings"
            intro="Browse current international rankings by meet, gender, age, or weight class."
        >
            {move || table_response(rankings, HEADERS.len(), "rankings", |rankings| {
                view! {
                    <ReferenceTable rows=rankings.to_vec() filters=FILTERS headers=HEADERS row=ranking_row sort empty_message="No rankings match these filters." />
                }
                .into_any()
            })}
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

    #[test]
    fn every_sort_order_in_the_menu_is_one_the_table_sorts_by() {
        crate::pages::comp_data::filters::assert_each_sort_order_parses_to_itself::<RankingSort>();
    }
}
