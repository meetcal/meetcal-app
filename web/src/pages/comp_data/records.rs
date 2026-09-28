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
struct Record {
    age_category: String,
    gender: String,
    weight_class: String,
    record_type: String,
    snatch_record: f64,
    cj_record: f64,
    total_record: f64,
}

impl ClassifiedRow for Record {
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
    ("total_desc", "Total: high to low"),
    ("total_asc", "Total: low to high"),
    ("snatch_desc", "Snatch: high to low"),
    ("snatch_asc", "Snatch: low to high"),
    ("cj_desc", "Clean & jerk: high to low"),
    ("cj_asc", "Clean & jerk: low to high"),
];

#[component]
pub fn Records() -> impl IntoView {
    let (record_type, set_record_type) = signal(String::new());
    let (gender, set_gender) = signal(String::new());
    let (age, set_age) = signal(String::new());
    let (weight_class, set_weight_class) = signal(String::new());
    let (sort, set_sort) = signal("total_desc".to_string());
    let records =
        LocalResource::new(|| async { get_api_response::<Record>("/data/records").await });

    view! {
        <DataPage
            heading="Records"
            intro="Filter record performances by organization, division, and weight class."
        >
            {move || records.with(|response| table_response(response, 7, "records", |records| {
                let types = filter_options(
                    records
                        .iter()
                        .filter(|record| record.record_type != "BWL")
                        .map(|record| record.record_type.as_str()),
                );
                let genders = filter_options(records.iter().map(|record| record.gender.as_str()));
                let ages = filter_options(records.iter().map(|record| record.age_category.as_str()));
                let weights = weight_class_options(records.iter().map(|record| record.weight_class.as_str()));
                let selected_type = record_type.get();
                let selected_gender = gender.get();
                let selected_age = age.get();
                let selected_weight = weight_class.get();
                let filters = ClassificationFilters { gender: &selected_gender, age_category: &selected_age, weight_class: &selected_weight };
                let mut filtered_records = classified_rows(records, &filters, |record| {
                    (selected_type.is_empty() || record.record_type == selected_type)
                        && record.record_type != "BWL"
                });

                match sort.get().as_str() {
                    "snatch_desc" => sort_numeric(&mut filtered_records, |row| row.snatch_record, SortDirection::Descending),
                    "snatch_asc" => sort_numeric(&mut filtered_records, |row| row.snatch_record, SortDirection::Ascending),
                    "cj_desc" => sort_numeric(&mut filtered_records, |row| row.cj_record, SortDirection::Descending),
                    "cj_asc" => sort_numeric(&mut filtered_records, |row| row.cj_record, SortDirection::Ascending),
                    "total_asc" => sort_numeric(&mut filtered_records, |row| row.total_record, SortDirection::Ascending),
                    _ => sort_numeric(&mut filtered_records, |row| row.total_record, SortDirection::Descending),
                }
                let is_empty = filtered_records.is_empty();
                let rows = filtered_records
                    .into_iter()
                    .map(|record| view! {
                        <tr>
                            <td>{record.record_type.clone()}</td>
                            <td>{record.gender.clone()}</td>
                            <td>{record.age_category.clone()}</td>
                            <td>{record.weight_class.clone()}</td>
                            <td>{record.snatch_record}</td>
                            <td>{record.cj_record}</td>
                            <td>{record.total_record}</td>
                        </tr>
                    })
                    .collect_view();

                view! {
                    <div class="data-filters">
                        <FilterSelect label="Organization" placeholder="All organizations" values=types selected=selected_type on_select=move |value| set_record_type.set(value) />
                        <FilterSelect label="Gender" placeholder="All genders" values=genders selected=selected_gender on_select=move |value| set_gender.set(value) />
                        <FilterSelect label="Age" placeholder="All ages" values=ages selected=selected_age on_select=move |value| set_age.set(value) />
                        <FilterSelect label="Weight class" placeholder="All classes" values=weights selected=selected_weight on_select=move |value| set_weight_class.set(value) />
                        <SortSelect options=SORT_OPTIONS set_sort />
                    </div>
                    <DataTable>
                        <thead>
                            <tr>
                                <th>"Type"</th>
                                <th>"Gender"</th>
                                <th>"Age"</th>
                                <th>"Weight class"</th>
                                <th>"Snatch"</th>
                                <th>"Clean & jerk"</th>
                                <th>"Total"</th>
                            </tr>
                        </thead>
                        <tbody>
                            {is_empty.then(|| view! { <EmptyTableRow columns=7 message="No records match these filters." /> })}
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
    fn record_deserializes_from_the_api_shape() {
        let record: Record = serde_json::from_str(
            r#"{"age_category":"Senior","gender":"Women","weight_class":"77kg","record_type":"USAW","snatch_record":130.0,"cj_record":160.0,"total_record":287.0}"#,
        )
        .unwrap();

        assert_eq!(record.record_type, "USAW");
        assert_eq!(record.total_record, 287.0);
    }
}
