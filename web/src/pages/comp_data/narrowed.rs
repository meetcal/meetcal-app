use super::address::{HistoryEntry, PageAddress, query_param};
use super::filters::filter_options;
use super::loading::{Load, LoadState, load_error};
use super::ui::FilterSelect;
use leptos::prelude::*;
use serde::Deserialize;
use serde_json::{Map, Value};

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub(crate) struct Category {
    #[serde(alias = "record_type", alias = "event_name")]
    pub kind: String,
    pub gender: String,
    pub age_category: String,
}

#[derive(Clone, Copy)]
pub(crate) struct Narrowing {
    pub kind_label: &'static str,
    pub kind_param: &'static str,
    pub kind_placeholder: &'static str,
    pub kind_argument: &'static str,
    pub kinds_left_out: &'static [&'static str],
}

pub(crate) const GENDER_PARAM: &str = "gender";
pub(crate) const AGE_PARAM: &str = "age";

pub(crate) type Choices = [String; 3];

impl Narrowing {
    pub(crate) fn params(self) -> [&'static str; 3] {
        [self.kind_param, GENDER_PARAM, AGE_PARAM]
    }

    pub(crate) fn options(self, categories: &[Category]) -> [Vec<String>; 3] {
        let listed = categories
            .iter()
            .filter(|category| !self.kinds_left_out.contains(&category.kind.as_str()))
            .collect::<Vec<_>>();
        [
            filter_options(listed.iter().map(|category| category.kind.as_str())),
            filter_options(listed.iter().map(|category| category.gender.as_str())),
            filter_options(listed.iter().map(|category| category.age_category.as_str())),
        ]
    }

    pub(crate) fn arguments(self, choices: &Choices) -> Value {
        let mut arguments = Map::new();
        for (name, choice) in [self.kind_argument, "gender", "ageCategory"]
            .into_iter()
            .zip(choices)
        {
            if !choice.is_empty() {
                arguments.insert(name.to_owned(), Value::from(choice.as_str()));
            }
        }
        Value::Object(arguments)
    }
}

pub(crate) fn offered(choices: Choices, options: Option<&[Vec<String>; 3]>) -> Choices {
    let Some(options) = options else {
        return choices;
    };
    let mut offered = choices;
    for (choice, values) in offered.iter_mut().zip(options) {
        if !values.contains(choice) {
            choice.clear();
        }
    }
    offered
}

pub(crate) fn narrowed_choices(
    narrowing: Narrowing,
    categories: Load<(), Vec<Category>>,
) -> Memo<Choices> {
    let [kind, gender, age] = narrowing.params().map(query_param);
    Memo::new(move |_| {
        let in_address = [kind.get(), gender.get(), age.get()];
        categories.with(|state| match state {
            LoadState::Ready(categories) => {
                offered(in_address, Some(&narrowing.options(categories)))
            }
            LoadState::Loading | LoadState::Failed(_) => in_address,
        })
    })
}

pub(crate) fn narrowing_row(
    narrowing: Narrowing,
    categories: Load<(), Vec<Category>>,
    chosen: Memo<Choices>,
    page: PageAddress,
    label: &'static str,
) -> AnyView {
    categories.with(|state| match state {
        LoadState::Ready(categories) => view! {
            <NarrowingSelects narrowing options=narrowing.options(categories) chosen page />
        }
        .into_any(),
        LoadState::Loading => view! {
            <NarrowingSelects narrowing options=Default::default() chosen page />
        }
        .into_any(),
        LoadState::Failed(error) => load_error(label, error, move || categories.retry()),
    })
}

#[component]
pub(crate) fn NarrowingSelects(
    narrowing: Narrowing,
    options: [Vec<String>; 3],
    chosen: Memo<Choices>,
    page: PageAddress,
) -> impl IntoView {
    let [kinds, genders, ages] = options;
    let labels = [
        (narrowing.kind_label, narrowing.kind_placeholder),
        ("Gender", "All genders"),
        ("Age", "All ages"),
    ];
    let selects = [kinds, genders, ages]
        .into_iter()
        .zip(labels)
        .zip(narrowing.params())
        .enumerate()
        .map(|(index, ((values, (label, placeholder)), param))| {
            view! {
                <FilterSelect
                    label
                    placeholder
                    values
                    selected=Signal::derive(move || chosen.with(|chosen| chosen.get(index).cloned().unwrap_or_default()))
                    on_select=move |value: String| page.change(&[(param, value.as_str())], HistoryEntry::Push)
                />
            }
        })
        .collect_view();
    view! { <div class="data-filters">{selects}</div> }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RECORDS: Narrowing = Narrowing {
        kind_label: "Organization",
        kind_param: "organization",
        kind_placeholder: "All organizations",
        kind_argument: "federation",
        kinds_left_out: &["BWL"],
    };

    fn category(kind: &str, gender: &str, age: &str) -> Category {
        Category {
            kind: kind.to_owned(),
            gender: gender.to_owned(),
            age_category: age.to_owned(),
        }
    }

    #[test]
    fn categories_of_either_table_read_as_one_kind() {
        let records: Vec<Category> = serde_json::from_str(
            r#"[{"record_type":"USAW","gender":"Women","age_category":"Senior"}]"#,
        )
        .unwrap();
        let totals: Vec<Category> = serde_json::from_str(
            r#"[{"event_name":"2027 Nationals","gender":"Men","age_category":"Junior"}]"#,
        )
        .unwrap();
        assert_eq!(records, [category("USAW", "Women", "Senior")]);
        assert_eq!(totals, [category("2027 Nationals", "Men", "Junior")]);
    }

    #[test]
    fn the_options_are_the_listed_categories_values_once_each() {
        let options = RECORDS.options(&[
            category("USAW", "Women", "Senior"),
            category("IWF", "Men", "Junior"),
            category("USAW", "Men", "Senior"),
            category("BWL", "Women", "U13"),
        ]);
        assert_eq!(options[0], ["IWF", "USAW"]);
        assert_eq!(options[1], ["Men", "Women"]);
        assert_eq!(options[2], ["Junior", "Senior"]);
    }

    #[test]
    fn a_choice_the_categories_do_not_offer_reads_as_no_filter_once_they_are_known() {
        let choices = ["USAW".to_owned(), "Nobody".to_owned(), String::new()];
        assert_eq!(offered(choices.clone(), None), choices);
        let options = [
            vec!["USAW".to_owned()],
            vec!["Women".to_owned()],
            Vec::new(),
        ];
        assert_eq!(
            offered(choices, Some(&options)),
            ["USAW".to_owned(), String::new(), String::new()]
        );
    }

    #[test]
    fn only_the_chosen_filters_are_sent_under_the_servers_names() {
        let choices = ["USAW".to_owned(), String::new(), "Senior".to_owned()];
        assert_eq!(
            RECORDS.arguments(&choices),
            serde_json::json!({"federation": "USAW", "ageCategory": "Senior"})
        );
        assert_eq!(
            RECORDS.arguments(&[String::new(), String::new(), String::new()]),
            serde_json::json!({})
        );
    }
}
