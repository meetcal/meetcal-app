use super::filters::{SortOrder, filter_options, matches_filter, weight_class_options};
use super::ui::{DataTable, EmptyTableRow, FilterSelect, SortSelect, TableHead};
use leptos::prelude::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum OptionOrder {
    Alphabetical,
    ByWeight,
}

pub(crate) struct Filter<R: 'static> {
    pub label: &'static str,
    pub placeholder: &'static str,
    pub value: fn(&R) -> &str,
    pub order: OptionOrder,
}

impl<R> Filter<R> {
    pub(crate) fn options(&self, rows: &[R]) -> Vec<String> {
        let values = rows.iter().map(|row| (self.value)(row));
        match self.order {
            OptionOrder::Alphabetical => filter_options(values),
            OptionOrder::ByWeight => weight_class_options(values),
        }
    }
}

pub(crate) trait TableSort<R>: SortOrder {
    fn sort(self, rows: &mut [&R]);
}

pub(crate) fn rows_shown<'a, R, S: TableSort<R>>(
    rows: &'a [R],
    filters: &[Filter<R>],
    chosen: &[String],
    order: S,
) -> Vec<&'a R> {
    let mut shown = rows
        .iter()
        .filter(|row| {
            filters
                .iter()
                .zip(chosen)
                .all(|(filter, choice)| matches_filter((filter.value)(row), choice))
        })
        .collect::<Vec<_>>();
    order.sort(&mut shown);
    shown
}

#[component]
pub(crate) fn ReferenceTable<R, S>(
    rows: Vec<R>,
    filters: &'static [Filter<R>],
    headers: &'static [&'static str],
    row: fn(&R) -> AnyView,
    sort: RwSignal<S>,
    empty_message: &'static str,
    #[prop(optional)] below_another_filter_row: bool,
) -> impl IntoView
where
    R: Send + Sync + 'static,
    S: TableSort<R>,
{
    let options = filters
        .iter()
        .map(|filter| filter.options(&rows))
        .collect::<Vec<_>>();
    let rows = StoredValue::new(rows);
    let chosen = RwSignal::new(vec![String::new(); filters.len()]);
    let filter_row_class = if below_another_filter_row {
        "data-filters data-filters-secondary"
    } else {
        "data-filters"
    };
    let selects = filters
        .iter()
        .zip(options)
        .enumerate()
        .map(|(index, (filter, values))| {
            view! {
                <FilterSelect
                    label=filter.label
                    placeholder=filter.placeholder
                    values
                    selected=Signal::derive(move || chosen.with(|chosen| chosen[index].clone()))
                    on_select=move |value: String| chosen.update(|chosen| chosen[index] = value)
                />
            }
        })
        .collect_view();

    view! {
        <div class=filter_row_class>
            {selects}
            <SortSelect sort=sort.read_only() set_sort=sort.write_only() />
        </div>
        <DataTable>
            <TableHead headers />
            <tbody>
                {move || {
                    let chosen = chosen.get();
                    let order = sort.get();
                    rows.with_value(|rows| {
                        let shown = rows_shown(rows, filters, &chosen, order);
                        if shown.is_empty() {
                            view! { <EmptyTableRow columns=headers.len() message=empty_message /> }.into_any()
                        } else {
                            shown.into_iter().map(row).collect_view().into_any()
                        }
                    })
                }}
            </tbody>
        </DataTable>
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pages::comp_data::filters::sort_orders;

    struct Lift {
        gender: &'static str,
        class: &'static str,
        total: f64,
    }

    fn gender(row: &Lift) -> &str {
        row.gender
    }

    fn class(row: &Lift) -> &str {
        row.class
    }

    const FILTERS: &[Filter<Lift>] = &[
        Filter {
            label: "Gender",
            placeholder: "All genders",
            value: gender,
            order: OptionOrder::Alphabetical,
        },
        Filter {
            label: "Weight class",
            placeholder: "All classes",
            value: class,
            order: OptionOrder::ByWeight,
        },
    ];

    sort_orders!(LiftSort {
        TotalDesc => ("total_desc", "Total: high to low"),
        TotalAsc => ("total_asc", "Total: low to high"),
    });

    impl TableSort<Lift> for LiftSort {
        fn sort(self, rows: &mut [&Lift]) {
            match self {
                LiftSort::TotalDesc => {
                    rows.sort_by(|left, right| right.total.total_cmp(&left.total))
                }
                LiftSort::TotalAsc => {
                    rows.sort_by(|left, right| left.total.total_cmp(&right.total))
                }
            }
        }
    }

    fn lifts() -> Vec<Lift> {
        vec![
            Lift {
                gender: "Women",
                class: "110+kg",
                total: 200.0,
            },
            Lift {
                gender: "Men",
                class: "65kg",
                total: 250.0,
            },
            Lift {
                gender: "Women",
                class: "69kg",
                total: 180.0,
            },
            Lift {
                gender: "Men",
                class: "110kg",
                total: 320.0,
            },
        ]
    }

    fn totals(rows: &[&Lift]) -> Vec<f64> {
        rows.iter().map(|row| row.total).collect()
    }

    #[test]
    fn a_filters_options_are_the_rows_own_values_once_each_in_its_order() {
        let rows = lifts();
        assert_eq!(FILTERS[0].options(&rows), ["Men", "Women"]);
        assert_eq!(
            FILTERS[1].options(&rows),
            ["65kg", "69kg", "110kg", "110+kg"]
        );
        assert!(FILTERS[0].options(&[]).is_empty());
    }

    #[test]
    fn rows_pass_every_chosen_filter_and_come_in_the_chosen_order() {
        let rows = lifts();
        let nothing_chosen = [String::new(), String::new()];
        assert_eq!(
            totals(&rows_shown(
                &rows,
                FILTERS,
                &nothing_chosen,
                LiftSort::TotalDesc
            )),
            [320.0, 250.0, 200.0, 180.0]
        );
        let women = ["Women".to_owned(), String::new()];
        assert_eq!(
            totals(&rows_shown(&rows, FILTERS, &women, LiftSort::TotalAsc)),
            [180.0, 200.0]
        );
        let women_69 = ["Women".to_owned(), "69kg".to_owned()];
        assert_eq!(
            totals(&rows_shown(&rows, FILTERS, &women_69, LiftSort::TotalDesc)),
            [180.0]
        );
        let men_69 = ["Men".to_owned(), "69kg".to_owned()];
        assert!(rows_shown(&rows, FILTERS, &men_69, LiftSort::TotalDesc).is_empty());
    }
}
