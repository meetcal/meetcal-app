use super::{
    filters::{compare_weight_classes, matches_filter, weight_class_options},
    loading::{Load, table_response},
    ui::{DataPage, DataTable, EmptyTableRow, FilterSelect, SortSelect},
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

#[derive(Debug, Deserialize)]
struct AdaptiveRecord {
    weight_class: String,
    snatch: f64,
    cj: f64,
    total: f64,
}

const SORT_OPTIONS: &[(&str, &str)] = &[
    ("weight_asc", "Weight class"),
    ("total_desc", "Total: high to low"),
    ("snatch_desc", "Snatch: high to low"),
    ("cj_desc", "Clean & jerk: high to low"),
];

#[component]
pub fn AdaptiveRecords() -> impl IntoView {
    let (gender, set_gender) = signal("Men".to_owned());
    let (weight_class, set_weight_class) = signal(String::new());
    let (sort, set_sort) = signal("weight_asc".to_owned());
    let records = Load::new(
        move || gender.get(),
        |gender| async move {
            let query = AdaptiveQuery {
                exclude_federation: "BWL",
                gender,
            };
            query_with::<Vec<AdaptiveRecord>, _>(queries::ADAPTIVE_RECORDS, &query)
                .await
                .map_err(|error| error.to_string())
        },
    );

    view! {
        <DataPage
            heading="Adaptive Records"
            intro="Top USAW and USAMW adaptive performances by gender and weight class."
        >
            // The query's own choice stays usable while its answer loads or after it fails.
            <div class="data-filters">
                <label>
                    "Gender"
                    <select
                        class="data-filter"
                        prop:value=move || gender.get()
                        on:change=move |event| {
                            set_gender.set(event_target_value(&event));
                            set_weight_class.set(String::new());
                        }
                    >
                        <option value="Men">"Men"</option>
                        <option value="Women">"Women"</option>
                    </select>
                </label>
            </div>
            {move || table_response(records, 4, "adaptive records", |records| {
                let weights = weight_class_options(records.iter().map(|row| row.weight_class.as_str()));
                let selected_weight = weight_class.get();
                let mut filtered = records
                    .iter()
                    .filter(|row| matches_filter(&row.weight_class, &selected_weight))
                    .collect::<Vec<_>>();
                match sort.get().as_str() {
                    "snatch_desc" => filtered.sort_by(|left, right| right.snatch.total_cmp(&left.snatch)),
                    "cj_desc" => filtered.sort_by(|left, right| right.cj.total_cmp(&left.cj)),
                    "total_desc" => filtered.sort_by(|left, right| right.total.total_cmp(&left.total)),
                    _ => filtered.sort_by(|left, right| compare_weight_classes(&left.weight_class, &right.weight_class)),
                }
                let is_empty = filtered.is_empty();
                let rows = filtered.into_iter().map(|row| view! {
                    <tr><td>{row.weight_class.clone()}</td><td>{row.snatch}</td><td>{row.cj}</td><td>{row.total}</td></tr>
                }).collect_view();

                view! {
                    <div class="data-filters data-filters-secondary">
                        <FilterSelect label="Weight class" placeholder="All classes" values=weights selected=weight_class on_select=move |value| set_weight_class.set(value) />
                        <SortSelect options=SORT_OPTIONS sort set_sort />
                    </div>
                    <DataTable>
                        <thead><tr><th>"Weight class"</th><th>"Snatch"</th><th>"Clean & jerk"</th><th>"Total"</th></tr></thead>
                        <tbody>{is_empty.then(|| view! { <EmptyTableRow columns=4 message="No adaptive records match these filters." /> })}{rows}</tbody>
                    </DataTable>
                }.into_any()
            })}
        </DataPage>
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let record: AdaptiveRecord = serde_json::from_str(
            r#"{"weight_class":"71kg","snatch":84.0,"cj":106.0,"total":190.0}"#,
        )
        .unwrap();

        assert_eq!(record.weight_class, "71kg");
        assert_eq!(record.total, 190.0);
    }
}
