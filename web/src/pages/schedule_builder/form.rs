use super::board::alert_line;
use super::models::{
    BREAK_MINUTES, Limit, MAX_ATHLETES_PER_PLATFORM, MAX_BUILDER_PLATFORMS, MAX_SESSIONS_PER_DAY,
    OptionsForm, SESSION_MINUTES, new_platform_name,
};
use crate::pages::comp_data::format::format_us_date;
use crate::utils::api::{Grouping, SessionOrder};
use leptos::prelude::*;

pub(crate) const BUILD_BUTTON_ID: &str = "builder-build";

const GROUPINGS: [(Grouping, &str); 2] = [
    (Grouping::WeightClass, "By Weight Class"),
    (Grouping::EntryTotal, "By Entry Total"),
];

const ORDERS: [(SessionOrder, &str); 3] = [
    (SessionOrder::WomenThenMen, "Women Then Men"),
    (SessionOrder::Alternate, "Alternate"),
    (SessionOrder::WomenDayMenDay, "Women’s Day, Men’s Day"),
];

#[component]
fn NumberField(
    form: RwSignal<OptionsForm>,
    label: &'static str,
    limit: Limit,
    read: fn(&OptionsForm) -> &String,
    write: fn(&mut OptionsForm, String),
    #[prop(optional)] placeholder: &'static str,
) -> impl IntoView {
    view! {
        <label class="builder-field">
            <span>{label}</span>
            <input
                class="builder-input"
                type="number"
                inputmode="numeric"
                min=limit.min
                max=limit.max
                step="1"
                placeholder=placeholder
                prop:value=move || form.with(|form| read(form).clone())
                on:input=move |event| form.update(|form| write(form, event_target_value(&event)))
            />
        </label>
    }
}

#[component]
pub(crate) fn OptionsPanel(
    form: RwSignal<OptionsForm>,
    #[prop(into)] on_build: Callback<()>,
    #[prop(into)] build_label: Signal<&'static str>,
    #[prop(into)] error: Signal<Option<String>>,
    busy: RwSignal<bool>,
) -> impl IntoView {
    let day_count = form.with_untracked(|form| form.days.len());
    let platform_count = Memo::new(move |_| form.with(|form| form.platforms.len()));
    view! {
        <section
            class="builder-panel builder-options no-print"
            aria-labelledby="builder-options-heading"
        >
            <h2 id="builder-options-heading">"Options"</h2>
            <form
                class="builder-options-form"
                novalidate=true
                on:submit=move |event| {
                    event.prevent_default();
                    on_build.run(());
                }
            >
                <fieldset class="builder-fieldset">
                    <legend>"Meet Days"</legend>
                    <div class="builder-days">
                        {(0..day_count)
                            .map(|index| {
                                let date = form
                                    .with_untracked(|form| {
                                        form.days.get(index).map(|day| day.date.clone())
                                    })
                                    .unwrap_or_default();
                                let shown = format_us_date(&date);
                                view! {
                                    <div class="builder-day">
                                        <label class="builder-check">
                                            <input
                                                type="checkbox"
                                                prop:checked=move || {
                                                    form.with(|form| {
                                                        form.days.get(index).is_some_and(|day| day.included)
                                                    })
                                                }
                                                on:change=move |event| {
                                                    let checked = event_target_checked(&event);
                                                    form.update(|form| {
                                                        if let Some(day) = form.days.get_mut(index) {
                                                            day.included = checked;
                                                        }
                                                    });
                                                }
                                            />
                                            <span>{shown.clone()}</span>
                                        </label>
                                        <label class="builder-field builder-day-start">
                                            <span>"First Start"</span>
                                            <input
                                                class="builder-input"
                                                type="time"
                                                step="300"
                                                aria-label=format!("First start on {shown}")
                                                prop:value=move || {
                                                    form.with(|form| {
                                                        form.days
                                                            .get(index)
                                                            .map(|day| day.first_start.clone())
                                                            .unwrap_or_default()
                                                    })
                                                }
                                                on:input=move |event| {
                                                    let value = event_target_value(&event);
                                                    form.update(|form| {
                                                        if let Some(day) = form.days.get_mut(index) {
                                                            day.first_start = value;
                                                        }
                                                    });
                                                }
                                            />
                                        </label>
                                    </div>
                                }
                            })
                            .collect_view()}
                    </div>
                </fieldset>
                <div class="builder-number-grid">
                    <NumberField
                        form
                        label="Session Length (Minutes)"
                        limit=SESSION_MINUTES
                        read=|form| &form.session_minutes
                        write=|form, value| form.session_minutes = value
                    />
                    <NumberField
                        form
                        label="Break Between Sessions (Minutes)"
                        limit=BREAK_MINUTES
                        read=|form| &form.break_minutes
                        write=|form, value| form.break_minutes = value
                    />
                    <NumberField
                        form
                        label="Max Athletes per Platform"
                        limit=MAX_ATHLETES_PER_PLATFORM
                        read=|form| &form.max_athletes_per_platform
                        write=|form, value| form.max_athletes_per_platform = value
                    />
                    <NumberField
                        form
                        label="Max Sessions per Day"
                        limit=MAX_SESSIONS_PER_DAY
                        placeholder="No Limit"
                        read=|form| &form.max_sessions_per_day
                        write=|form, value| form.max_sessions_per_day = value
                    />
                </div>
                <fieldset class="builder-fieldset">
                    <legend>"Platforms"</legend>
                    <div class="builder-platforms">
                        {move || {
                            (0..platform_count.get())
                                .map(|index| {
                                    view! {
                                        <div class="builder-platform-row">
                                            <input
                                                class="builder-input"
                                                type="text"
                                                maxlength="30"
                                                aria-label=format!("Platform {} name", index + 1)
                                                prop:value=move || {
                                                    form.with(|form| {
                                                        form.platforms.get(index).cloned().unwrap_or_default()
                                                    })
                                                }
                                                on:input=move |event| {
                                                    let value = event_target_value(&event);
                                                    form.update(|form| {
                                                        if let Some(name) = form.platforms.get_mut(index) {
                                                            *name = value;
                                                        }
                                                    });
                                                }
                                            />
                                            <button
                                                type="button"
                                                class="builder-button-quiet"
                                                aria-label=format!("Remove platform {}", index + 1)
                                                disabled=move || { platform_count.get() <= 1 }
                                                on:click=move |_| {
                                                    form.update(|form| {
                                                        if index < form.platforms.len() {
                                                            form.platforms.remove(index);
                                                        }
                                                    })
                                                }
                                            >
                                                "Remove"
                                            </button>
                                        </div>
                                    }
                                })
                                .collect_view()
                        }}
                    </div>
                    <button
                        type="button"
                        class="builder-button-quiet"
                        disabled=move || { platform_count.get() >= MAX_BUILDER_PLATFORMS }
                        on:click=move |_| {
                            form.update(|form| {
                                let name = new_platform_name(&form.platforms);
                                form.platforms.push(name);
                            })
                        }
                    >
                        "Add Platform"
                    </button>
                </fieldset>
                <fieldset class="builder-fieldset">
                    <legend>"Grouping"</legend>
                    <div class="builder-choices">
                        {GROUPINGS
                            .into_iter()
                            .map(|(grouping, label)| {
                                view! {
                                    <label class="builder-check">
                                        <input
                                            type="radio"
                                            name="builder-grouping"
                                            prop:checked=move || {
                                                form.with(|form| form.grouping == grouping)
                                            }
                                            on:change=move |_| {
                                                form.update(|form| form.grouping = grouping)
                                            }
                                        />
                                        <span>{label}</span>
                                    </label>
                                }
                            })
                            .collect_view()}
                    </div>
                    <label class="builder-check">
                        <input
                            type="checkbox"
                            prop:checked=move || form.with(|form| form.separate_age_groups)
                            on:change=move |event| {
                                let checked = event_target_checked(&event);
                                form.update(|form| form.separate_age_groups = checked);
                            }
                        />
                        <span>"Separate Youth and Masters"</span>
                    </label>
                </fieldset>
                <fieldset class="builder-fieldset">
                    <legend>"Order"</legend>
                    <div class="builder-choices">
                        {ORDERS
                            .into_iter()
                            .map(|(order, label)| {
                                view! {
                                    <label class="builder-check">
                                        <input
                                            type="radio"
                                            name="builder-order"
                                            prop:checked=move || form.with(|form| form.order == order)
                                            on:change=move |_| form.update(|form| form.order = order)
                                        />
                                        <span>{label}</span>
                                    </label>
                                }
                            })
                            .collect_view()}
                    </div>
                </fieldset>
                {move || alert_line(error.get(), "access-inline-error builder-error")}
                <button
                    id=BUILD_BUTTON_ID
                    class="builder-button builder-build"
                    type="submit"
                    disabled=busy
                >
                    {move || build_label.get()}
                </button>
            </form>
        </section>
    }
}
