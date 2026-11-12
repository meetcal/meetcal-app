use super::{
    filters::{SortDirection, sort_numeric, sort_orders},
    format::{display_weight_class, reference_value},
    loading::{load_rows, table_response},
    reference_table::{Filter, OptionOrder, ReferenceTable, TableSort},
    ui::DataPage,
};
use crate::utils::api::queries;
use leptos::prelude::*;
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
struct Standard {
    age_category: String,
    gender: String,
    standard_a: f64,
    standard_b: f64,
    weight_class: String,
}

impl Standard {
    fn shown(self) -> Self {
        Self {
            weight_class: display_weight_class(&self.weight_class),
            ..self
        }
    }
}

fn gender(standard: &Standard) -> &str {
    &standard.gender
}

fn age(standard: &Standard) -> &str {
    &standard.age_category
}

fn weight_class(standard: &Standard) -> &str {
    &standard.weight_class
}

const FILTERS: &[Filter<Standard>] = &[
    Filter {
        label: "Gender",
        param: "gender",
        placeholder: "All genders",
        value: gender,
        order: OptionOrder::Alphabetical,
    },
    Filter {
        label: "Age",
        param: "age",
        placeholder: "All ages",
        value: age,
        order: OptionOrder::Alphabetical,
    },
    Filter {
        label: "Weight class",
        param: "class",
        placeholder: "All classes",
        value: weight_class,
        order: OptionOrder::ByWeight,
    },
];

const HEADERS: &[&str] = &["Gender", "Age", "Weight class", "A", "B"];

sort_orders!(StandardSort {
    ADesc => ("standard_a_desc", "A: high to low"),
    AAsc => ("standard_a_asc", "A: low to high"),
    BDesc => ("standard_b_desc", "B: high to low"),
    BAsc => ("standard_b_asc", "B: low to high"),
});

impl TableSort<Standard> for StandardSort {
    fn sort(self, rows: &mut [&Standard]) {
        match self {
            StandardSort::AAsc => {
                sort_numeric(rows, |row| row.standard_a, SortDirection::Ascending)
            }
            StandardSort::BDesc => {
                sort_numeric(rows, |row| row.standard_b, SortDirection::Descending)
            }
            StandardSort::BAsc => {
                sort_numeric(rows, |row| row.standard_b, SortDirection::Ascending)
            }
            StandardSort::ADesc => {
                sort_numeric(rows, |row| row.standard_a, SortDirection::Descending)
            }
        }
    }
}

fn standard_row(standard: &Standard) -> AnyView {
    view! {
        <tr>
            <td>{standard.gender.clone()}</td>
            <td>{standard.age_category.clone()}</td>
            <td>{standard.weight_class.clone()}</td>
            <td>{reference_value(Some(standard.standard_a))}</td>
            <td>{reference_value(Some(standard.standard_b))}</td>
        </tr>
    }
    .into_any()
}

#[component]
pub fn Standards() -> impl IntoView {
    let standards = load_rows(queries::STANDARDS, Standard::shown);

    view! {
        <DataPage
            heading="Standards"
            intro="A and B standards by gender, age category, and weight class."
        >
            {move || table_response(standards, HEADERS.len(), "standards", |standards| {
                view! {
                    <ReferenceTable rows=standards.to_vec() filters=FILTERS headers=HEADERS row=standard_row path="/standards" default_sort=StandardSort::ADesc empty_message="No standards match these filters." />
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
    fn standards_read_the_servers_answer() {
        let answers: Vec<Vec<Standard>> =
            wire::read(queries::STANDARDS, wire_fixture!("reference.standards"));
        let a: Vec<_> = answers.iter().flatten().map(|row| row.standard_a).collect();
        assert_eq!(a, [210.0, 300.0]);
    }

    #[test]
    fn standard_deserializes_from_the_api_shape() {
        let standard: Standard = serde_json::from_str(
            r#"{"age_category":"Junior","gender":"Men","standard_a":285.0,"standard_b":260.0,"weight_class":"79kg"}"#,
        )
        .unwrap();

        assert_eq!(standard.standard_a, 285.0);
        assert_eq!(standard.standard_b, 260.0);
    }

    // U15 has no B standard; the table answers 0, shown as "—" rather than "0".
    #[test]
    fn u15_b_standard_of_zero_shows_none() {
        let standard: Standard = serde_json::from_str(
            r#"{"age_category":"U15","gender":"Men","standard_a":184.0,"standard_b":0.0,"weight_class":"55kg"}"#,
        )
        .unwrap();

        assert_eq!(reference_value(Some(standard.standard_a)), "184");
        assert_eq!(reference_value(Some(standard.standard_b)), "—");
    }

    #[test]
    fn every_sort_order_in_the_menu_is_one_the_table_sorts_by() {
        crate::pages::comp_data::filters::assert_each_sort_order_parses_to_itself::<StandardSort>();
    }

    #[test]
    fn an_open_class_reads_as_the_other_tables_write_it() {
        let standard: Standard = serde_json::from_str(
            r#"{"age_category":"Senior","gender":"Women","standard_a":250.0,"standard_b":230.0,"weight_class":"+86kg"}"#,
        )
        .unwrap();
        assert_eq!(standard.shown().weight_class, "86+kg");
    }
}
