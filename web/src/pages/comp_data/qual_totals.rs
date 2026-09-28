use super::{
    filters::{
        ClassificationFilters, ClassifiedRow, SortDirection, classified_rows, filter_options,
        sort_numeric, sort_text, weight_class_options,
    },
    loading::table_response,
    ui::{DataPage, DataTable, EmptyTableRow, FilterSelect, SortSelect},
};
use crate::utils::api::get_api_response;
use leptos::prelude::*;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct QualifyingTotal {
    pub qualifying_total: f64,
    pub event_name: String,
    pub gender: String,
    pub age_category: String,
    pub weight_class: String,
}

impl ClassifiedRow for QualifyingTotal {
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
    ("total_asc", "Total: low to high"),
    ("total_desc", "Total: high to low"),
    ("event_asc", "Event: A to Z"),
    ("event_desc", "Event: Z to A"),
];

#[component]
pub fn QualifyingTotals() -> impl IntoView {
    let (gender, set_gender) = signal(String::new());
    let (meet, set_meet) = signal(String::new());
    let (age, set_age) = signal(String::new());
    let (weight_class, set_weight_class) = signal(String::new());
    let (sort, set_sort) = signal("total_asc".to_string());

    let totals = LocalResource::new(move || async move {
        get_api_response::<QualifyingTotal>("/data/qualifying-totals").await
    });

    view! {
        <DataPage
            heading="Qualifying Totals"
            intro="Filter qualification totals by event, gender, age category, or weight class."
        >
            {move || {
                totals.with(|response| table_response(response, 5, "qualifying totals", |rows| {
                    let meets = filter_options(rows.iter().map(|row| row.event_name.as_str()));
                    let genders = filter_options(rows.iter().map(|row| row.gender.as_str()));
                    let ages = filter_options(rows.iter().map(|row| row.age_category.as_str()));
                    let weights = weight_class_options(rows.iter().map(|row| row.weight_class.as_str()));

                    let selected_meet = meet.get();
                    let selected_gender = gender.get();
                    let selected_age = age.get();
                    let selected_weight = weight_class.get();
                    let filters = ClassificationFilters { gender: &selected_gender, age_category: &selected_age, weight_class: &selected_weight };
                    let mut filtered_totals = classified_rows(rows, &filters, |row| {
                        selected_meet.is_empty() || row.event_name == selected_meet
                    });

                    match sort.get().as_str() {
                        "total_desc" => sort_numeric(&mut filtered_totals, |row| row.qualifying_total, SortDirection::Descending),
                        "event_asc" => sort_text(&mut filtered_totals, |row| &row.event_name, SortDirection::Ascending),
                        "event_desc" => sort_text(&mut filtered_totals, |row| &row.event_name, SortDirection::Descending),
                        _ => sort_numeric(&mut filtered_totals, |row| row.qualifying_total, SortDirection::Ascending),
                    }
                    let is_empty = filtered_totals.is_empty();
                    let rows = filtered_totals
                        .into_iter()
                        .map(|row| {
                            view! {
                                <tr>
                                    <td>{row.event_name.clone()}</td>
                                    <td>{row.gender.clone()}</td>
                                    <td>{row.age_category.clone()}</td>
                                    <td>{row.weight_class.clone()}</td>
                                    <td>{row.qualifying_total}</td>
                                </tr>
                            }
                        })
                        .collect_view();

                    view! {
                        <div class="data-filters">
                            <FilterSelect label="Event" placeholder="All events" values=meets selected=selected_meet on_select=move |value| set_meet.set(value) />
                            <FilterSelect label="Gender" placeholder="All genders" values=genders selected=selected_gender on_select=move |value| set_gender.set(value) />
                            <FilterSelect label="Age" placeholder="All ages" values=ages selected=selected_age on_select=move |value| set_age.set(value) />
                            <FilterSelect label="Weight class" placeholder="All classes" values=weights selected=selected_weight on_select=move |value| set_weight_class.set(value) />
                            <SortSelect options=SORT_OPTIONS set_sort />
                        </div>
                        <DataTable>
                            <thead>
                                <tr>
                                    <th>"Event"</th>
                                    <th>"Gender"</th>
                                    <th>"Age"</th>
                                    <th>"Weight class"</th>
                                    <th>"Total"</th>
                                </tr>
                            </thead>
                            <tbody>
                                {is_empty.then(|| view! { <EmptyTableRow columns=5 message="No qualifying totals match these filters." /> })}
                                {rows}
                            </tbody>
                        </DataTable>
                    }
                    .into_any()
                }))
            }}
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
}
