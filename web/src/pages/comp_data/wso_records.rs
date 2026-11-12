use super::{
    address::{HistoryEntry, query_param, use_page_address},
    filters::{compare_weight_classes, sort_orders},
    format::{display_weight_class, reference_value},
    loading::{Load, load_query, select_response, table_response},
    models::RecordHolder,
    reference_table::{Filter, OptionOrder, ReferenceTable, TableSort, filters_cleared},
    ui::{DataPage, DataStatus, FilterSelect, RecordLift},
};
use crate::utils::api::{queries, query_with};
use leptos::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
struct WsoRecordsQuery {
    wso: String,
}

#[derive(Clone, Debug, Deserialize)]
struct WsoRecord {
    age_category: String,
    cj_record: Option<f64>,
    gender: String,
    snatch_record: Option<f64>,
    total_record: Option<f64>,
    weight_class: String,
    #[serde(default)]
    snatch_by: Option<RecordHolder>,
    #[serde(default)]
    cj_by: Option<RecordHolder>,
    #[serde(default)]
    total_by: Option<RecordHolder>,
}

impl WsoRecord {
    fn shown(self) -> Self {
        Self {
            weight_class: display_weight_class(&self.weight_class),
            ..self
        }
    }
}

fn gender(record: &WsoRecord) -> &str {
    &record.gender
}

fn age(record: &WsoRecord) -> &str {
    &record.age_category
}

fn weight_class(record: &WsoRecord) -> &str {
    &record.weight_class
}

const FILTERS: &[Filter<WsoRecord>] = &[
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

const HEADERS: &[&str] = &[
    "Gender",
    "Age",
    "Weight class",
    "Snatch",
    "Clean & jerk",
    "Total",
];

sort_orders!(WsoRecordSort {
    TotalDesc => ("total_desc", "Total: high to low"),
    SnatchDesc => ("snatch_desc", "Snatch: high to low"),
    CjDesc => ("cj_desc", "Clean & jerk: high to low"),
    WeightAsc => ("weight_asc", "Weight class"),
});

impl TableSort<WsoRecord> for WsoRecordSort {
    fn sort(self, rows: &mut [&WsoRecord]) {
        match self {
            WsoRecordSort::SnatchDesc => rows.sort_by(|left, right| {
                right
                    .snatch_record
                    .unwrap_or_default()
                    .total_cmp(&left.snatch_record.unwrap_or_default())
            }),
            WsoRecordSort::CjDesc => rows.sort_by(|left, right| {
                right
                    .cj_record
                    .unwrap_or_default()
                    .total_cmp(&left.cj_record.unwrap_or_default())
            }),
            WsoRecordSort::WeightAsc => rows.sort_by(|left, right| {
                compare_weight_classes(&left.weight_class, &right.weight_class)
            }),
            WsoRecordSort::TotalDesc => rows.sort_by(|left, right| {
                right
                    .total_record
                    .unwrap_or_default()
                    .total_cmp(&left.total_record.unwrap_or_default())
            }),
        }
    }
}

fn record_row(record: &WsoRecord) -> AnyView {
    view! {
        <tr>
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

const PATH: &str = "/wso-records";

#[component]
pub fn WsoRecords() -> impl IntoView {
    let page = use_page_address(PATH);
    let wso = query_param("wso");

    let organizations = load_query::<Vec<String>>(queries::WSO_LIST);
    let records = Load::new(
        move || wso.get(),
        |selected_wso| async move {
            if selected_wso.is_empty() {
                return Ok(Vec::new());
            }
            query_with::<Vec<WsoRecord>, _>(
                queries::WSO_RECORDS,
                &WsoRecordsQuery { wso: selected_wso },
            )
            .await
            .map(|records| records.into_iter().map(WsoRecord::shown).collect())
            .map_err(|error| error.to_string())
        },
    );

    view! {
        <DataPage
            heading="WSO Records"
            intro="Browse records published by USA Weightlifting state organizations."
        >
            {move || select_response(organizations, "Loading organizations…", "WSOs", |organizations| view! {
                <div class="data-filters">
                    <FilterSelect
                        label="Organization"
                        placeholder="Choose a WSO"
                        values=organizations.to_vec()
                        selected=wso
                        on_select=move |value: String| {
                            let mut changes = filters_cleared(FILTERS);
                            changes.push(("wso", value.as_str()));
                            page.change(&changes, HistoryEntry::Push);
                        }
                    />
                </div>
            }.into_any())}

            {move || if wso.get().is_empty() {
                view! { <DataStatus message="Choose an organization to view its records." /> }.into_any()
            } else {
                table_response(records, HEADERS.len(), "WSO records", |records| {
                    view! {
                        <ReferenceTable rows=records.to_vec() filters=FILTERS headers=HEADERS row=record_row path=PATH default_sort=WsoRecordSort::TotalDesc empty_message="No WSO records match these filters." below_another_filter_row=true />
                    }
                    .into_any()
                })
            }}
        </DataPage>
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_and_unset_lifts_use_an_em_dash() {
        assert_eq!(reference_value(None), "—");
        // About 196 WSO classes answer 0/0/0 for "no record set".
        assert_eq!(reference_value(Some(0.0)), "—");
        assert_eq!(reference_value(Some(112.5)), "112.5");
    }

    #[test]
    fn wso_query_names_the_organization() {
        let query = serde_json::to_value(WsoRecordsQuery {
            wso: "Carolina WSO".to_owned(),
        })
        .unwrap();

        assert_eq!(query, serde_json::json!({"wso": "Carolina WSO"}));
    }

    #[test]
    fn wso_record_accepts_nullable_lifts() {
        let record: WsoRecord = serde_json::from_str(
            r#"{"age_category":"Senior","cj_record":null,"gender":"Women","snatch_record":80.0,"total_record":null,"weight_class":"58kg","wso":"Carolina","snatch_by":{"name":"Ada Lift","date":"2024-03-02","location":"Raleigh, NC"},"cj_by":null,"total_by":null}"#,
        )
        .unwrap();

        assert_eq!(record.snatch_record, Some(80.0));
        assert_eq!(record.cj_record, None);
        assert_eq!(record.total_record, None);
        assert_eq!(
            record
                .snatch_by
                .and_then(|holder| holder.detail())
                .as_deref(),
            Some("March 2, 2024 · Raleigh, NC")
        );
        assert_eq!(record.cj_by, None);
    }

    #[test]
    fn every_sort_order_in_the_menu_is_one_the_table_sorts_by() {
        crate::pages::comp_data::filters::assert_each_sort_order_parses_to_itself::<WsoRecordSort>(
        );
    }

    #[test]
    fn a_class_without_its_unit_reads_as_the_other_tables_write_it() {
        let record = |class: &str| -> WsoRecord {
            serde_json::from_value(serde_json::json!({
                "age_category": "Senior", "cj_record": 100.0, "gender": "Men", "snatch_record": 80.0,
                "total_record": 180.0, "weight_class": class
            }))
            .unwrap()
        };
        assert_eq!(record("110").shown().weight_class, "110kg");
        assert_eq!(record("110+").shown().weight_class, "110+kg");
        assert_eq!(record("69kg").shown().weight_class, "69kg");
    }
}
