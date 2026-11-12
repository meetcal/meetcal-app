use super::{
    address::{HistoryEntry, query_param, use_page_address},
    filters::{compare_weight_classes, sort_orders},
    format::{GENDERS, display_weight_class, reference_value},
    loading::{Load, table_response},
    reference_table::{Filter, OptionOrder, ReferenceTable, TableSort, filters_cleared},
    ui::DataPage,
};
use crate::utils::api::{queries, query_with};
use leptos::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AdaptiveQuery {
    exclude_federation: &'static str,
    gender: String,
}

#[derive(Clone, Debug, Deserialize)]
struct AdaptiveRecord {
    weight_class: String,
    snatch: f64,
    cj: f64,
    total: f64,
}

impl AdaptiveRecord {
    fn shown(self) -> Self {
        Self {
            weight_class: display_weight_class(&self.weight_class),
            ..self
        }
    }
}

fn weight_class(record: &AdaptiveRecord) -> &str {
    &record.weight_class
}

const FILTERS: &[Filter<AdaptiveRecord>] = &[Filter {
    label: "Weight class",
    param: "class",
    placeholder: "All classes",
    value: weight_class,
    order: OptionOrder::ByWeight,
}];

const HEADERS: &[&str] = &["Weight class", "Snatch", "Clean & jerk", "Total"];

sort_orders!(AdaptiveRecordSort {
    WeightAsc => ("weight_asc", "Weight class"),
    TotalDesc => ("total_desc", "Total: high to low"),
    SnatchDesc => ("snatch_desc", "Snatch: high to low"),
    CjDesc => ("cj_desc", "Clean & jerk: high to low"),
});

impl TableSort<AdaptiveRecord> for AdaptiveRecordSort {
    fn sort(self, rows: &mut [&AdaptiveRecord]) {
        match self {
            AdaptiveRecordSort::SnatchDesc => {
                rows.sort_by(|left, right| right.snatch.total_cmp(&left.snatch))
            }
            AdaptiveRecordSort::CjDesc => rows.sort_by(|left, right| right.cj.total_cmp(&left.cj)),
            AdaptiveRecordSort::TotalDesc => {
                rows.sort_by(|left, right| right.total.total_cmp(&left.total))
            }
            AdaptiveRecordSort::WeightAsc => rows.sort_by(|left, right| {
                compare_weight_classes(&left.weight_class, &right.weight_class)
            }),
        }
    }
}

fn record_row(record: &AdaptiveRecord) -> AnyView {
    view! {
        <tr>
            <td>{record.weight_class.clone()}</td>
            <td>{reference_value(Some(record.snatch))}</td>
            <td>{reference_value(Some(record.cj))}</td>
            <td>{reference_value(Some(record.total))}</td>
        </tr>
    }
    .into_any()
}

const DEFAULT_GENDER: &str = "Men";

fn shown_gender(chosen: &str) -> &'static str {
    GENDERS
        .into_iter()
        .find(|gender| *gender == chosen)
        .unwrap_or(DEFAULT_GENDER)
}

const PATH: &str = "/adaptive-records";

#[component]
pub fn AdaptiveRecords() -> impl IntoView {
    let page = use_page_address(PATH);
    let gender_in_address = query_param("gender");
    let gender = Memo::new(move |_| {
        gender_in_address
            .with(|chosen| shown_gender(chosen))
            .to_owned()
    });
    let records = Load::new(
        move || gender.get(),
        |gender| async move {
            let query = AdaptiveQuery {
                exclude_federation: "BWL",
                gender,
            };
            query_with::<Vec<AdaptiveRecord>, _>(queries::ADAPTIVE_RECORDS, &query)
                .await
                .map(|records| records.into_iter().map(AdaptiveRecord::shown).collect())
                .map_err(|error| error.to_string())
        },
    );

    view! {
        <DataPage
            heading="Adaptive Records"
            intro="Top USAW and USAMW adaptive performances by gender and weight class."
        >
            <div class="data-filters">
                <label>
                    "Gender"
                    <select
                        class="data-filter"
                        prop:value=move || gender.get()
                        on:change=move |event| {
                            let chosen = event_target_value(&event);
                            let mut changes = filters_cleared(FILTERS);
                            changes.push(("gender", if chosen == DEFAULT_GENDER { "" } else { chosen.as_str() }));
                            page.change(&changes, HistoryEntry::Push);
                        }
                    >
                        {GENDERS.map(|choice| view! { <option value=choice selected=move || gender.with(|gender| gender == choice)>{choice}</option> })}
                    </select>
                </label>
            </div>
            {move || table_response(records, HEADERS.len(), "adaptive records", |records| {
                view! {
                    <ReferenceTable rows=records.to_vec() filters=FILTERS headers=HEADERS row=record_row path=PATH default_sort=AdaptiveRecordSort::WeightAsc empty_message="No adaptive records match these filters." below_another_filter_row=true />
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
    fn the_address_gender_is_shown_only_when_the_page_offers_it() {
        assert_eq!(shown_gender("Women"), "Women");
        assert_eq!(shown_gender("Men"), "Men");
        assert_eq!(shown_gender(""), DEFAULT_GENDER);
        assert_eq!(shown_gender("women"), DEFAULT_GENDER);
    }

    #[test]
    fn adaptive_query_matches_the_backend_contract() {
        let query = serde_json::to_value(AdaptiveQuery {
            exclude_federation: "BWL",
            gender: "Women".to_owned(),
        })
        .unwrap();

        assert_eq!(
            query,
            serde_json::json!({"excludeFederation": "BWL", "gender": "Women"})
        );
    }

    #[test]
    fn adaptive_record_deserializes_from_the_api_shape() {
        // The server sends the class without its unit.
        let record: AdaptiveRecord =
            serde_json::from_str(r#"{"weight_class":"71","snatch":84.0,"cj":106.0,"total":190.0}"#)
                .unwrap();

        assert_eq!(record.weight_class, "71");
        assert_eq!(record.total, 190.0);
        assert_eq!(record.shown().weight_class, "71kg");
        let open: AdaptiveRecord = serde_json::from_str(
            r#"{"weight_class":"110+","snatch":84.0,"cj":106.0,"total":190.0}"#,
        )
        .unwrap();
        assert_eq!(open.shown().weight_class, "110+kg");
    }

    #[test]
    fn every_sort_order_in_the_menu_is_one_the_table_sorts_by() {
        crate::pages::comp_data::filters::assert_each_sort_order_parses_to_itself::<
            AdaptiveRecordSort,
        >();
    }
}
