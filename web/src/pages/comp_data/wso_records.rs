use super::{
    filters::{compare_weight_classes, filter_options, matches_filter, weight_class_options},
    loading::{select_response, table_response},
    ui::{DataPage, DataStatus, DataTable, EmptyTableRow, FilterSelect, SortSelect},
};
use crate::utils::api::{get_api_response, get_api_response_with_query};
use leptos::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
struct WsoRecordsQuery {
    wso: String,
}

#[derive(Debug, Deserialize)]
struct WsoRecord {
    age_category: String,
    cj_record: Option<f64>,
    gender: String,
    snatch_record: Option<f64>,
    total_record: Option<f64>,
    weight_class: String,
}

fn lift_value(value: Option<f64>) -> String {
    value
        .map(|value| value.to_string())
        .unwrap_or_else(|| "—".to_owned())
}

const SORT_OPTIONS: &[(&str, &str)] = &[
    ("total_desc", "Total: high to low"),
    ("snatch_desc", "Snatch: high to low"),
    ("cj_desc", "Clean & jerk: high to low"),
    ("weight_asc", "Weight class"),
];

#[component]
pub fn WsoRecords() -> impl IntoView {
    let (wso, set_wso) = signal(String::new());
    let (gender, set_gender) = signal(String::new());
    let (age, set_age) = signal(String::new());
    let (weight_class, set_weight_class) = signal(String::new());
    let (sort, set_sort) = signal("total_desc".to_owned());

    let organizations =
        LocalResource::new(|| async { get_api_response::<String>("/data/wso").await });
    let records = LocalResource::new(move || {
        let selected_wso = wso.get();
        async move {
            if selected_wso.is_empty() {
                Ok(Vec::new())
            } else {
                get_api_response_with_query::<Vec<WsoRecord>, _>(
                    "/data/wso/records",
                    &WsoRecordsQuery { wso: selected_wso },
                )
                .await
            }
        }
    });

    view! {
        <DataPage
            heading="WSO Records"
            intro="Browse records published by USA Weightlifting state organizations."
        >
            {move || organizations.with(|response| select_response(response, "Loading organizations…", "WSOs", |organizations| view! {
                <div class="data-filters">
                    <FilterSelect
                        label="Organization"
                        placeholder="Choose a WSO"
                        values=organizations.to_vec()
                        selected=wso.get()
                        on_select=move |value: String| {
                            set_wso.set(value);
                            set_gender.set(String::new());
                            set_age.set(String::new());
                            set_weight_class.set(String::new());
                        }
                    />
                </div>
            }.into_any()))}

            {move || if wso.get().is_empty() {
                view! { <DataStatus message="Choose an organization to view its records." /> }.into_any()
            } else {
                records.with(|response| table_response(response, 6, "WSO records", |records| {
                    let genders = filter_options(records.iter().map(|row| row.gender.as_str()));
                    let ages = filter_options(records.iter().map(|row| row.age_category.as_str()));
                    let weights = weight_class_options(records.iter().map(|row| row.weight_class.as_str()));
                    let selected_gender = gender.get();
                    let selected_age = age.get();
                    let selected_weight = weight_class.get();
                    let mut filtered = records.iter().filter(|row| {
                        matches_filter(&row.gender, &selected_gender)
                            && matches_filter(&row.age_category, &selected_age)
                            && matches_filter(&row.weight_class, &selected_weight)
                    }).collect::<Vec<_>>();
                    match sort.get().as_str() {
                        "snatch_desc" => filtered.sort_by(|left, right| right.snatch_record.unwrap_or_default().total_cmp(&left.snatch_record.unwrap_or_default())),
                        "cj_desc" => filtered.sort_by(|left, right| right.cj_record.unwrap_or_default().total_cmp(&left.cj_record.unwrap_or_default())),
                        "weight_asc" => filtered.sort_by(|left, right| compare_weight_classes(&left.weight_class, &right.weight_class)),
                        _ => filtered.sort_by(|left, right| right.total_record.unwrap_or_default().total_cmp(&left.total_record.unwrap_or_default())),
                    }
                    let is_empty = filtered.is_empty();
                    let rows = filtered.into_iter().map(|row| view! {
                        <tr>
                            <td>{row.gender.clone()}</td><td>{row.age_category.clone()}</td>
                            <td>{row.weight_class.clone()}</td><td>{lift_value(row.snatch_record)}</td>
                            <td>{lift_value(row.cj_record)}</td><td>{lift_value(row.total_record)}</td>
                        </tr>
                    }).collect_view();

                    view! {
                        <div class="data-filters data-filters-secondary">
                            <FilterSelect label="Gender" placeholder="All genders" values=genders selected=selected_gender on_select=move |value| set_gender.set(value) />
                            <FilterSelect label="Age" placeholder="All ages" values=ages selected=selected_age on_select=move |value| set_age.set(value) />
                            <FilterSelect label="Weight class" placeholder="All classes" values=weights selected=selected_weight on_select=move |value| set_weight_class.set(value) />
                            <SortSelect options=SORT_OPTIONS set_sort />
                        </div>
                        <DataTable>
                            <thead><tr><th>"Gender"</th><th>"Age"</th><th>"Weight class"</th><th>"Snatch"</th><th>"Clean & jerk"</th><th>"Total"</th></tr></thead>
                            <tbody>{is_empty.then(|| view! { <EmptyTableRow columns=6 message="No WSO records match these filters." /> })}{rows}</tbody>
                        </DataTable>
                    }.into_any()
                }))
            }}
        </DataPage>
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_lifts_use_an_em_dash() {
        assert_eq!(lift_value(None), "—");
        assert_eq!(lift_value(Some(112.5)), "112.5");
    }

    #[test]
    fn wso_query_percent_encodes_the_organization() {
        let query = serde_urlencoded::to_string(WsoRecordsQuery {
            wso: "Carolina WSO".to_owned(),
        })
        .unwrap();

        assert_eq!(query, "wso=Carolina+WSO");
    }

    #[test]
    fn wso_record_accepts_nullable_lifts() {
        let record: WsoRecord = serde_json::from_str(
            r#"{"age_category":"Senior","cj_record":null,"gender":"Women","snatch_record":80.0,"total_record":null,"weight_class":"58kg","wso":"Carolina"}"#,
        )
        .unwrap();

        assert_eq!(record.snatch_record, Some(80.0));
        assert_eq!(record.cj_record, None);
        assert_eq!(record.total_record, None);
    }
}
