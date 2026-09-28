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
struct Standard {
    age_category: String,
    gender: String,
    standard_a: f64,
    standard_b: f64,
    weight_class: String,
}

impl ClassifiedRow for Standard {
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
    ("standard_a_desc", "A: high to low"),
    ("standard_a_asc", "A: low to high"),
    ("standard_b_desc", "B: high to low"),
    ("standard_b_asc", "B: low to high"),
];

#[component]
pub fn Standards() -> impl IntoView {
    let (gender, set_gender) = signal(String::new());
    let (age, set_age) = signal(String::new());
    let (weight_class, set_weight_class) = signal(String::new());
    let (sort, set_sort) = signal("standard_a_desc".to_string());
    let standards =
        LocalResource::new(|| async { get_api_response::<Standard>("/data/standards").await });

    view! {
        <DataPage
            heading="Standards"
            intro="A and B standards by gender, age category, and weight class."
        >
            {move || standards.with(|response| table_response(response, 5, "standards", |rows| {
                let genders = filter_options(rows.iter().map(|row| row.gender.as_str()));
                let ages = filter_options(rows.iter().map(|row| row.age_category.as_str()));
                let weights = weight_class_options(rows.iter().map(|row| row.weight_class.as_str()));
                let selected_gender = gender.get();
                let selected_age = age.get();
                let selected_weight = weight_class.get();
                let filters = ClassificationFilters { gender: &selected_gender, age_category: &selected_age, weight_class: &selected_weight };
                let mut filtered_standards = classified_rows(rows, &filters, |_| true);

                match sort.get().as_str() {
                    "standard_a_asc" => sort_numeric(&mut filtered_standards, |row| row.standard_a, SortDirection::Ascending),
                    "standard_b_desc" => sort_numeric(&mut filtered_standards, |row| row.standard_b, SortDirection::Descending),
                    "standard_b_asc" => sort_numeric(&mut filtered_standards, |row| row.standard_b, SortDirection::Ascending),
                    _ => sort_numeric(&mut filtered_standards, |row| row.standard_a, SortDirection::Descending),
                }
                let is_empty = filtered_standards.is_empty();
                let rows = filtered_standards
                    .into_iter()
                    .map(|row| view! {
                        <tr>
                            <td>{row.gender.clone()}</td>
                            <td>{row.age_category.clone()}</td>
                            <td>{row.weight_class.clone()}</td>
                            <td>{row.standard_a}</td>
                            <td>{row.standard_b}</td>
                        </tr>
                    })
                    .collect_view();

                view! {
                    <div class="data-filters">
                        <FilterSelect label="Gender" placeholder="All genders" values=genders selected=selected_gender on_select=move |value| set_gender.set(value) />
                        <FilterSelect label="Age" placeholder="All ages" values=ages selected=selected_age on_select=move |value| set_age.set(value) />
                        <FilterSelect label="Weight class" placeholder="All classes" values=weights selected=selected_weight on_select=move |value| set_weight_class.set(value) />
                        <SortSelect options=SORT_OPTIONS set_sort />
                    </div>
                    <DataTable>
                        <thead>
                            <tr>
                                <th>"Gender"</th>
                                <th>"Age"</th>
                                <th>"Weight class"</th>
                                <th>"A"</th>
                                <th>"B"</th>
                            </tr>
                        </thead>
                        <tbody>
                            {is_empty.then(|| view! { <EmptyTableRow columns=5 message="No standards match these filters." /> })}
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
    fn standard_deserializes_from_the_api_shape() {
        let standard: Standard = serde_json::from_str(
            r#"{"age_category":"Junior","gender":"Men","standard_a":285.0,"standard_b":260.0,"weight_class":"79kg"}"#,
        )
        .unwrap();

        assert_eq!(standard.standard_a, 285.0);
        assert_eq!(standard.standard_b, 260.0);
    }
}
