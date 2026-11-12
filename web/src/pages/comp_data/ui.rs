use super::catalog::DataPageLink;
use super::filters::SortOrder;
use super::models::RecordHolder;
use leptos::prelude::*;

#[component]
pub(crate) fn DataPage(
    page: DataPageLink,
    #[prop(default = "data-page")] section_class: &'static str,
    children: Children,
) -> impl IntoView {
    view! {
        <section class=section_class>
            <p class="data-eyebrow">"Competition Data"</p>
            <h1>{page.heading}</h1>
            <p class="data-intro">{page.intro}</p>
            {children()}
        </section>
    }
}

#[component]
pub(crate) fn DataStatus(message: &'static str) -> impl IntoView {
    view! { <p class="data-status">{message}</p> }
}

#[component]
pub(crate) fn SelectOptions(values: Vec<String>, selected: Option<String>) -> impl IntoView {
    values
        .into_iter()
        .map(|value| {
            let is_selected = selected.as_ref().is_some_and(|selected| selected == &value);

            view! {
                <option value=value.clone() selected=is_selected>
                    {value.clone()}
                </option>
            }
        })
        .collect_view()
}

pub(crate) const SELECT_STEP_SETTLE: std::time::Duration = std::time::Duration::from_millis(350);

pub(crate) fn steps_the_choice(key: &str) -> bool {
    matches!(
        key,
        "ArrowUp"
            | "ArrowDown"
            | "ArrowLeft"
            | "ArrowRight"
            | "Home"
            | "End"
            | "PageUp"
            | "PageDown"
    ) || (key.chars().count() == 1 && key != " ")
}

#[component]
pub(crate) fn FilterSelect(
    label: &'static str,
    placeholder: &'static str,
    values: Vec<String>,
    #[prop(into)] selected: Signal<String>,
    #[prop(into)] on_select: Callback<String>,
    #[prop(optional)] wide: bool,
) -> impl IntoView {
    let class = if wide {
        "data-filter data-filter-wide"
    } else {
        "data-filter"
    };
    let stepping = StoredValue::new(false);
    let pending = StoredValue::new_local(None::<(TimeoutHandle, String)>);
    let commit_pending = move || {
        if let Some((timer, value)) = pending.try_update_value(Option::take).flatten() {
            timer.clear();
            on_select.run(value);
        }
    };
    let choose = move |value: String| {
        if let Some((timer, _)) = pending.try_update_value(Option::take).flatten() {
            timer.clear();
        }
        if !stepping.get_value() {
            on_select.run(value);
            return;
        }
        if let Ok(timer) = set_timeout_with_handle(commit_pending, SELECT_STEP_SETTLE) {
            pending.set_value(Some((timer, value)));
        }
    };
    on_cleanup(move || {
        if let Some((timer, _)) = pending.try_update_value(Option::take).flatten() {
            timer.clear();
        }
    });

    view! {
        <label>
            {label}
            <select
                class=class
                prop:value=move || selected.get()
                on:keydown=move |event| stepping.set_value(steps_the_choice(&event.key()))
                on:pointerdown=move |_| stepping.set_value(false)
                on:blur=move |_| commit_pending()
                on:change=move |event| choose(event_target_value(&event))
            >
                <option value="">{placeholder}</option>
                <SelectOptions values selected=Some(selected.get_untracked()) />
            </select>
        </label>
    }
}

#[component]
pub(crate) fn SortSelect<S: SortOrder>(
    #[prop(into)] sort: Signal<S>,
    #[prop(into)] on_sort: Callback<S>,
) -> impl IntoView {
    let initial = sort.get_untracked();
    view! {
        <label class="data-sort">
            "Sort"
            <select
                class="data-filter"
                prop:value=move || sort.get().value()
                on:change=move |event| {
                    if let Some(order) = S::parse(&event_target_value(&event)) {
                        on_sort.run(order);
                    }
                }
            >
                {S::ALL
                    .iter()
                    .map(|order| {
                        view! {
                            <option value=order.value() selected=*order == initial>
                                {order.label()}
                            </option>
                        }
                    })
                    .collect_view()}
            </select>
        </label>
    }
}

#[component]
pub(crate) fn DataMetric(label: &'static str, value: String) -> impl IntoView {
    view! { <div class="data-metric"><span>{label}</span><strong>{value}</strong></div> }
}

/// A record lift's cell: the weight, then who set it, when and where.
#[component]
pub(crate) fn RecordLift(value: String, holder: Option<RecordHolder>) -> impl IntoView {
    let holder = holder.map(|holder| {
        let detail = holder.detail();
        view! {
            <span class="record-holder">{holder.name}</span>
            {detail.map(|detail| view! { <span class="record-holder-detail">{detail}</span> })}
        }
    });
    view! {
        <td class="record-lift">
            <span class="record-value">{value}</span>
            {holder}
        </td>
    }
}

#[component]
pub(crate) fn DataTable(children: Children) -> impl IntoView {
    view! {
        <div class="data-table-wrap">
            <table class="data-table">{children()}</table>
        </div>
    }
}

pub(crate) const ROWS_SHOWN_FIRST: usize = 100;
pub(crate) const ROWS_ADDED_BY_SHOW_MORE: usize = 100;

pub(crate) fn rows_shown_for(order: &[usize], raised: Option<&(Vec<usize>, usize)>) -> usize {
    let limit = raised
        .filter(|(raised_for, _)| raised_for.as_slice() == order)
        .map_or(ROWS_SHOWN_FIRST, |(_, limit)| *limit);
    limit.min(order.len())
}

#[component]
pub(crate) fn RowsTable<R>(
    headers: &'static [&'static str],
    rows: StoredValue<Vec<R>>,
    #[prop(into)] order: Signal<Vec<usize>>,
    row: fn(&R) -> AnyView,
    empty_message: &'static str,
) -> impl IntoView
where
    R: Send + Sync + 'static,
{
    let raised = RwSignal::new(None::<(Vec<usize>, usize)>);
    let shown = Memo::new(move |_| {
        order.with(|order| raised.with(|raised| rows_shown_for(order, raised.as_ref())))
    });
    let visible = Memo::new(move |_| {
        order.with(|order| order.iter().take(shown.get()).copied().collect::<Vec<_>>())
    });
    let total = Memo::new(move |_| order.with(Vec::len));
    let show_more = move |_| {
        raised.set(Some((
            order.get_untracked(),
            shown.get_untracked() + ROWS_ADDED_BY_SHOW_MORE,
        )));
    };

    view! {
        <DataTable>
            <TableHead headers />
            <tbody>
                <For
                    each=move || visible.get()
                    key=|index| *index
                    children=move |index| rows.with_value(|rows| rows.get(index).map(row))
                />
                {move || (total.get() == 0).then(|| view! { <EmptyTableRow columns=headers.len() message=empty_message /> })}
            </tbody>
        </DataTable>
        {move || (shown.get() < total.get()).then(|| view! {
            <div class="data-more">
                <p class="data-status">{format!("{} of {} rows", shown.get(), total.get())}</p>
                <button class="data-more-button" type="button" on:click=show_more>"Show More"</button>
            </div>
        })}
    }
}

#[component]
pub(crate) fn StaticRowsTable<R>(
    headers: &'static [&'static str],
    rows: Vec<R>,
    row: fn(&R) -> AnyView,
    empty_message: &'static str,
) -> impl IntoView
where
    R: Send + Sync + 'static,
{
    let order = (0..rows.len()).collect::<Vec<_>>();
    view! {
        <RowsTable headers rows=StoredValue::new(rows) order=Signal::stored(order) row empty_message />
    }
}

#[component]
pub(crate) fn TableHead(headers: &'static [&'static str]) -> impl IntoView {
    view! {
        <thead>
            <tr>{headers.iter().map(|header| view! { <th>{*header}</th> }).collect_view()}</tr>
        </thead>
    }
}

#[component]
pub(crate) fn TableSkeleton(columns: usize) -> impl IntoView {
    let header_cells = (0..columns)
        .map(|_| view! { <th><span class="data-skeleton"></span></th> })
        .collect_view();
    let rows = (0..8)
        .map(|_| {
            let cells = (0..columns)
                .map(|_| view! { <td><span class="data-skeleton"></span></td> })
                .collect_view();

            view! { <tr>{cells}</tr> }
        })
        .collect_view();

    view! {
        <div class="data-table-wrap" aria-busy="true" aria-label="Loading data">
            <table class="data-table data-table-skeleton">
                <thead><tr>{header_cells}</tr></thead>
                <tbody>{rows}</tbody>
            </table>
        </div>
    }
}

#[component]
pub(crate) fn EmptyTableRow(columns: usize, message: &'static str) -> impl IntoView {
    view! {
        <tr class="data-empty-row">
            <td colspan=columns>{message}</td>
        </tr>
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_long_table_renders_through_rows_table() {
        let bounded = [
            ("club_dashboard.rs", "one club's athletes at one meet"),
            ("wso_elite.rs", "the top 20 of each list"),
        ];
        for (name, page) in [
            ("adaptive_records.rs", include_str!("adaptive_records.rs")),
            ("club_dashboard.rs", include_str!("club_dashboard.rs")),
            ("meet_center.rs", include_str!("meet_center.rs")),
            ("national_rankings.rs", include_str!("national_rankings.rs")),
            ("qual_totals.rs", include_str!("qual_totals.rs")),
            ("rankings.rs", include_str!("rankings.rs")),
            ("records.rs", include_str!("records.rs")),
            ("reference_table.rs", include_str!("reference_table.rs")),
            ("results.rs", include_str!("results.rs")),
            ("standards.rs", include_str!("standards.rs")),
            ("wrapped.rs", include_str!("wrapped.rs")),
            ("wso_dashboard.rs", include_str!("wso_dashboard.rs")),
            ("wso_elite.rs", include_str!("wso_elite.rs")),
            ("wso_records.rs", include_str!("wso_records.rs")),
        ] {
            let own_rows = page.contains("<tbody>");
            let allowed = bounded.iter().any(|(bounded, _)| *bounded == name);
            assert!(
                !own_rows || allowed,
                "{name} renders its own <tbody>: render long tables through RowsTable"
            );
        }
    }

    #[test]
    fn keys_that_step_through_a_closed_select_wait_for_a_pause_and_picks_do_not() {
        for key in ["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "b"] {
            assert!(steps_the_choice(key), "{key}");
        }
        for key in ["Enter", " ", "Tab", "Escape"] {
            assert!(!steps_the_choice(key), "{key}");
        }
    }

    #[test]
    fn a_table_shows_its_first_rows_until_asked_for_more_of_the_same_rows() {
        let order = (0..842).collect::<Vec<_>>();
        assert_eq!(rows_shown_for(&order, None), ROWS_SHOWN_FIRST);
        assert_eq!(rows_shown_for(&order[..40], None), 40);
        let raised = (order.clone(), ROWS_SHOWN_FIRST + ROWS_ADDED_BY_SHOW_MORE);
        assert_eq!(rows_shown_for(&order, Some(&raised)), 200);
        let refiltered = order
            .iter()
            .copied()
            .filter(|index| index % 2 == 0)
            .collect::<Vec<_>>();
        assert_eq!(rows_shown_for(&refiltered, Some(&raised)), ROWS_SHOWN_FIRST);
        let everything = (order.clone(), 10_000);
        assert_eq!(rows_shown_for(&order, Some(&everything)), 842);
    }
}
