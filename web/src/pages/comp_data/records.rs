use super::{
    address::use_page_address,
    catalog,
    filters::{SortDirection, sort_numeric, sort_orders},
    format::{display_weight_class, reference_value},
    loading::{Load, load_query, select_response, table_response},
    models::RecordHolder,
    narrowed::{Category, Narrowing, NarrowingSelects, narrowed_choices},
    reference_table::{Filter, OptionOrder, ReferenceTable, TableSort},
    ui::{DataPage, RecordLift},
};
use crate::utils::api::{queries, query_with};
use leptos::prelude::*;
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
struct Record {
    age_category: String,
    gender: String,
    weight_class: String,
    record_type: String,
    #[serde(deserialize_with = "lift_that_must_be_sent")]
    snatch_record: Option<f64>,
    #[serde(deserialize_with = "lift_that_must_be_sent")]
    cj_record: Option<f64>,
    #[serde(deserialize_with = "lift_that_must_be_sent")]
    total_record: Option<f64>,
    #[serde(default)]
    snatch_by: Option<RecordHolder>,
    #[serde(default)]
    cj_by: Option<RecordHolder>,
    #[serde(default)]
    total_by: Option<RecordHolder>,
}

fn lift_that_must_be_sent<'de, D>(deserializer: D) -> Result<Option<f64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<f64>::deserialize(deserializer)
}

impl Record {
    fn shown(self) -> Self {
        Self {
            weight_class: display_weight_class(&self.weight_class),
            ..self
        }
    }
}

const FEDERATION_NOT_LISTED: &str = "BWL";

const PATH: &str = "/records";

fn listed(records: &[Record]) -> Vec<Record> {
    records
        .iter()
        .filter(|record| record.record_type != FEDERATION_NOT_LISTED)
        .cloned()
        .collect()
}

fn weight_class(record: &Record) -> &str {
    &record.weight_class
}

const FILTERS: &[Filter<Record>] = &[Filter {
    label: "Weight class",
    param: "class",
    placeholder: "All classes",
    value: weight_class,
    order: OptionOrder::ByWeight,
}];

const NARROWING: Narrowing = Narrowing {
    kind_label: "Organization",
    kind_param: "organization",
    kind_placeholder: "All organizations",
    kind_argument: "federation",
    kinds_left_out: &[FEDERATION_NOT_LISTED],
};

pub(crate) const HEADERS: &[&str] = &[
    "Type",
    "Gender",
    "Age",
    "Weight class",
    "Snatch",
    "Clean & jerk",
    "Total",
];

sort_orders!(RecordSort {
    TotalDesc => ("total_desc", "Total: high to low"),
    TotalAsc => ("total_asc", "Total: low to high"),
    SnatchDesc => ("snatch_desc", "Snatch: high to low"),
    SnatchAsc => ("snatch_asc", "Snatch: low to high"),
    CjDesc => ("cj_desc", "Clean & jerk: high to low"),
    CjAsc => ("cj_asc", "Clean & jerk: low to high"),
});

impl TableSort<Record> for RecordSort {
    fn sort(self, rows: &mut [&Record]) {
        match self {
            RecordSort::SnatchDesc => sort_numeric(
                rows,
                |row| row.snatch_record.unwrap_or_default(),
                SortDirection::Descending,
            ),
            RecordSort::SnatchAsc => sort_numeric(
                rows,
                |row| row.snatch_record.unwrap_or_default(),
                SortDirection::Ascending,
            ),
            RecordSort::CjDesc => sort_numeric(
                rows,
                |row| row.cj_record.unwrap_or_default(),
                SortDirection::Descending,
            ),
            RecordSort::CjAsc => sort_numeric(
                rows,
                |row| row.cj_record.unwrap_or_default(),
                SortDirection::Ascending,
            ),
            RecordSort::TotalAsc => sort_numeric(
                rows,
                |row| row.total_record.unwrap_or_default(),
                SortDirection::Ascending,
            ),
            RecordSort::TotalDesc => sort_numeric(
                rows,
                |row| row.total_record.unwrap_or_default(),
                SortDirection::Descending,
            ),
        }
    }
}

fn record_row(record: &Record) -> AnyView {
    view! {
        <tr>
            <td>{record.record_type.clone()}</td>
            <td>{record.gender.clone()}</td>
            <td>{record.age_category.clone()}</td>
            <td>{record.weight_class.clone()}</td>
            <RecordLift value=reference_value(record.snatch_record) holder=record.snatch_by.clone() />
            <RecordLift value=reference_value(record.cj_record) holder=record.cj_by.clone() />
            <RecordLift value=reference_value(record.total_record) holder=record.total_by.clone() />
        </tr>
    }
    .into_any()
}

#[component]
pub fn Records() -> impl IntoView {
    let page = use_page_address(PATH);
    let categories = load_query::<Vec<Category>>(queries::RECORD_CATEGORIES);
    let chosen = narrowed_choices(NARROWING, categories);
    let records = Load::new(
        move || chosen.get(),
        |chosen| async move {
            query_with::<Vec<Record>, _>(queries::RECORDS, &NARROWING.arguments(&chosen))
                .await
                .map(|records| records.into_iter().map(Record::shown).collect())
                .map_err(|error| error.to_string())
        },
    );

    view! {
        <DataPage page=catalog::RECORDS>
            {move || select_response(categories, "Loading the record lists…", "record lists", |categories| {
                view! { <NarrowingSelects narrowing=NARROWING options=NARROWING.options(categories) chosen page /> }.into_any()
            })}
            {move || table_response(records, HEADERS.len(), "records", |records| {
                view! {
                    <ReferenceTable rows=listed(records) filters=FILTERS headers=HEADERS row=record_row path=PATH default_sort=RecordSort::TotalDesc empty_message="No records match these filters." below_another_filter_row=true />
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
    fn records_read_the_servers_answer() {
        let answers: Vec<Vec<Record>> =
            wire::read(queries::RECORDS, wire_fixture!("reference.records"));
        let holders: Vec<_> = answers
            .iter()
            .flatten()
            .map(|record| (record.snatch_by.is_some(), record.total_record))
            .collect();
        assert_eq!(holders, [(true, Some(250.0)), (false, Some(260.0))]);
    }

    #[test]
    fn record_deserializes_from_the_api_shape() {
        let record: Record = serde_json::from_str(
            r#"{"age_category":"Senior","gender":"Women","weight_class":"77kg","record_type":"USAW","snatch_record":130.0,"cj_record":160.0,"total_record":287.0,"snatch_by":{"name":"Ada Lift","date":"2025-06-01","location":"Columbus, OH"},"cj_by":{"name":"Standard","date":null,"location":null},"total_by":null}"#,
        )
        .unwrap();

        assert_eq!(record.record_type, "USAW");
        assert_eq!(record.total_record, Some(287.0));
        assert_eq!(
            record.snatch_by.map(|holder| holder.name).as_deref(),
            Some("Ada Lift")
        );
        assert_eq!(record.cj_by.and_then(|holder| holder.detail()), None);
        assert_eq!(record.total_by, None);
    }

    #[test]
    fn a_record_without_one_of_its_lifts_is_unreadable() {
        let missing_total = r#"{"age_category":"Senior","gender":"Women","weight_class":"77kg","record_type":"USAW","snatch_record":130.0,"cj_record":160.0}"#;
        assert!(serde_json::from_str::<Record>(missing_total).is_err());
    }

    #[test]
    fn record_without_holders_still_deserializes() {
        let record: Record = serde_json::from_str(
            r#"{"age_category":"Senior","gender":"Women","weight_class":"77kg","record_type":"USAW","snatch_record":130.0,"cj_record":160.0,"total_record":287.0}"#,
        )
        .unwrap();

        assert_eq!(record.snatch_by, None);
    }

    fn record(record_type: &str, age: &str, weight_class: &str) -> Record {
        serde_json::from_value(serde_json::json!({
            "age_category": age, "gender": "Women", "weight_class": weight_class,
            "record_type": record_type, "snatch_record": 100.0, "cj_record": 120.0, "total_record": 220.0
        }))
        .unwrap()
    }

    #[test]
    fn the_class_filter_offers_only_what_the_listed_records_hold_in_one_class_form() {
        let records = [
            record("USAW", "Senior", "86+kg"),
            record("IWF", "Senior", "+86kg"),
            record("BWL", "U20", "88+kg"),
        ]
        .map(Record::shown);
        assert_eq!(FILTERS[0].options(&listed(&records)), ["86+kg"]);
    }

    // A class with one unset lift used to be missing from the answer; it now answers that lift
    // as 0 (or null), shown as "—".
    #[test]
    fn record_with_an_unset_lift_deserializes_and_shows_none() {
        let record: Record = serde_json::from_str(
            r#"{"age_category":"Masters 60","gender":"Women","weight_class":"58kg","record_type":"UMWF","snatch_record":40.0,"cj_record":0.0,"total_record":null,"snatch_by":{"name":"Ada Lift","date":null,"location":null},"cj_by":null,"total_by":null}"#,
        )
        .unwrap();

        assert_eq!(reference_value(record.snatch_record), "40");
        assert_eq!(reference_value(record.cj_record), "—");
        assert_eq!(reference_value(record.total_record), "—");
    }

    #[test]
    fn every_sort_order_in_the_menu_is_one_the_table_sorts_by() {
        crate::pages::comp_data::filters::assert_each_sort_order_parses_to_itself::<RecordSort>();
    }
}
