use super::{
    filters::{SortDirection, sort_numeric, sort_orders, sort_text},
    format::display_weight_class,
    loading::{load_rows, table_response},
    reference_table::{Filter, OptionOrder, ReferenceTable, TableSort},
    ui::DataPage,
};
use crate::utils::api::queries;
use leptos::prelude::*;
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
pub struct QualifyingTotal {
    pub qualifying_total: f64,
    pub event_name: String,
    pub gender: String,
    pub age_category: String,
    pub weight_class: String,
}

impl QualifyingTotal {
    fn shown(self) -> Self {
        Self {
            weight_class: display_weight_class(&self.weight_class),
            ..self
        }
    }
}

fn event(total: &QualifyingTotal) -> &str {
    &total.event_name
}

fn gender(total: &QualifyingTotal) -> &str {
    &total.gender
}

fn age(total: &QualifyingTotal) -> &str {
    &total.age_category
}

fn weight_class(total: &QualifyingTotal) -> &str {
    &total.weight_class
}

const FILTERS: &[Filter<QualifyingTotal>] = &[
    Filter {
        label: "Event",
        placeholder: "All events",
        value: event,
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

const HEADERS: &[&str] = &["Event", "Gender", "Age", "Weight class", "Total"];

sort_orders!(QualifyingTotalSort {
    TotalAsc => ("total_asc", "Total: low to high"),
    TotalDesc => ("total_desc", "Total: high to low"),
    EventAsc => ("event_asc", "Event: A to Z"),
    EventDesc => ("event_desc", "Event: Z to A"),
});

impl TableSort<QualifyingTotal> for QualifyingTotalSort {
    fn sort(self, rows: &mut [&QualifyingTotal]) {
        match self {
            QualifyingTotalSort::TotalDesc => {
                sort_numeric(rows, |row| row.qualifying_total, SortDirection::Descending)
            }
            QualifyingTotalSort::EventAsc => {
                sort_text(rows, |row| &row.event_name, SortDirection::Ascending)
            }
            QualifyingTotalSort::EventDesc => {
                sort_text(rows, |row| &row.event_name, SortDirection::Descending)
            }
            QualifyingTotalSort::TotalAsc => {
                sort_numeric(rows, |row| row.qualifying_total, SortDirection::Ascending)
            }
        }
    }
}

fn total_row(total: &QualifyingTotal) -> AnyView {
    view! {
        <tr>
            <td>{total.event_name.clone()}</td>
            <td>{total.gender.clone()}</td>
            <td>{total.age_category.clone()}</td>
            <td>{total.weight_class.clone()}</td>
            <td>{total.qualifying_total}</td>
        </tr>
    }
    .into_any()
}

#[component]
pub fn QualifyingTotals() -> impl IntoView {
    let sort = RwSignal::new(QualifyingTotalSort::TotalAsc);
    let totals = load_rows(queries::QUALIFYING_TOTALS, QualifyingTotal::shown);

    view! {
        <DataPage
            heading="Qualifying Totals"
            intro="Filter qualification totals by event, gender, age category, or weight class."
        >
            {move || table_response(totals, HEADERS.len(), "qualifying totals", |totals| {
                view! {
                    <ReferenceTable rows=totals.to_vec() filters=FILTERS headers=HEADERS row=total_row sort empty_message="No qualifying totals match these filters." />
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
    fn qualifying_total_deserializes_from_the_api_shape() {
        let total: QualifyingTotal = serde_json::from_str(
            r#"{"qualifying_total":215.5,"event_name":"Nationals","gender":"Women","age_category":"Senior","weight_class":"69kg"}"#,
        )
        .unwrap();

        assert_eq!(total.event_name, "Nationals");
        assert_eq!(total.qualifying_total, 215.5);
    }

    #[test]
    fn every_sort_order_in_the_menu_is_one_the_table_sorts_by() {
        crate::pages::comp_data::filters::assert_each_sort_order_parses_to_itself::<
            QualifyingTotalSort,
        >();
    }

    #[test]
    fn a_class_without_its_unit_reads_as_the_other_tables_write_it() {
        let total: QualifyingTotal = serde_json::from_str(
            r#"{"qualifying_total":215.5,"event_name":"Nationals","gender":"Women","age_category":"Senior","weight_class":"+86"}"#,
        )
        .unwrap();
        assert_eq!(total.shown().weight_class, "86+kg");
    }
}
