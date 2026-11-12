use super::models::{
    BuiltAthlete, BuiltGroup, BuiltSchedule, BuiltSession, is_clock, move_targets, session_when,
};
use crate::pages::comp_data::format::{
    display_weight_class, format_us_date, format_us_time, reference_value,
};
use crate::utils::api::{BuilderEdit, BuilderOptions};
use leptos::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum MenuId {
    Athlete(String),
    Class {
        session: u32,
        platform: String,
        weight_class: String,
    },
    Swap(u32),
    Time(u32),
}

#[derive(Clone, Copy)]
pub(crate) struct BoardActions {
    pub open_menu: RwSignal<Option<MenuId>>,
    pub add_edit: Callback<BuilderEdit>,
}

#[derive(Clone, Copy)]
struct BoardData {
    sessions: StoredValue<Vec<BuiltSession>>,
    options: StoredValue<BuilderOptions>,
}

#[component]
pub(crate) fn Menu(
    id: MenuId,
    actions: BoardActions,
    #[prop(into)] label: String,
    #[prop(into)] whose: String,
    #[prop(into)] title: String,
    #[prop(default = "builder-menu-button")] button_class: &'static str,
    #[prop(default = "menu")] role: &'static str,
    children: ChildrenFn,
) -> impl IntoView {
    let open_menu = actions.open_menu;
    let is_open = {
        let id = id.clone();
        Memo::new(move |_| open_menu.with(|open| open.as_ref() == Some(&id)))
    };
    let toggle = move |_| {
        if is_open.get_untracked() {
            open_menu.set(None);
        } else {
            open_menu.set(Some(id.clone()));
        }
    };
    let children = StoredValue::new(children);
    let title = StoredValue::new(title);
    view! {
        <div class="builder-menu no-print">
            <button
                type="button"
                class=button_class
                aria-haspopup=if role == "menu" { "menu" } else { "dialog" }
                aria-expanded=move || if is_open.get() { "true" } else { "false" }
                on:click=toggle
            >
                <span class="visually-hidden">{whose}</span>
                {label}
            </button>
            <Show when=move || is_open.get()>
                <div class="builder-menu-backdrop" on:click=move |_| open_menu.set(None)></div>
                <div class="builder-menu-panel" role=role aria-label=title.get_value()>
                    <p class="builder-menu-title">{title.get_value()}</p>
                    {children.with_value(|children| children())}
                </div>
            </Show>
        </div>
    }
}

#[component]
fn MenuItem(
    actions: BoardActions,
    #[prop(into)] label: String,
    edit: BuilderEdit,
) -> impl IntoView {
    let edit = StoredValue::new(edit);
    view! {
        <button
            type="button"
            role="menuitem"
            class="builder-menu-item"
            on:click=move |_| {
                actions.open_menu.set(None);
                actions.add_edit.run(edit.get_value());
            }
        >
            {label}
        </button>
    }
}

#[component]
pub(crate) fn Board(
    schedule: BuiltSchedule,
    options: BuilderOptions,
    busy: bool,
    actions: BoardActions,
) -> impl IntoView {
    let data = BoardData {
        sessions: StoredValue::new(schedule.sessions.clone()),
        options: StoredValue::new(options),
    };
    view! {
        <div
            class="builder-board"
            class:builder-board-busy=busy
            aria-busy=busy.then_some("true")
            data-testid="schedule-board"
        >
            {schedule
                .sessions
                .into_iter()
                .map(|session| view! { <SessionCard session data actions /> })
                .collect_view()}
        </div>
    }
}

fn session_times(session: &BuiltSession) -> String {
    if !session.is_scheduled() {
        return "No Time".to_owned();
    }
    format!(
        "{} · Weigh-In {} · Start {}",
        format_us_date(&session.date),
        format_us_time(&session.weigh_in_time),
        format_us_time(&session.start_time)
    )
}

#[component]
fn SessionCard(session: BuiltSession, data: BoardData, actions: BoardActions) -> impl IntoView {
    let id = session.id;
    let number = session.number;
    let times = session_times(&session);
    let unscheduled = !session.is_scheduled();
    let start = StoredValue::new((session.date.clone(), session.start_time.clone()));
    view! {
        <article class="builder-session" class:builder-session-unscheduled=unscheduled>
            <header class="builder-session-head">
                <div class="builder-session-title">
                    <h3>{format!("Session {number}")}</h3>
                    <p class="builder-session-when">{times}</p>
                </div>
                <div class="builder-session-actions">
                    <Menu
                        id=MenuId::Swap(id)
                        actions
                        label="Swap With…"
                        whose=format!("Session {number}: ")
                        title="Swap With…"
                    >
                        {move || {
                            data.sessions
                                .with_value(|sessions| {
                                    sessions
                                        .iter()
                                        .filter(|other| other.id != id)
                                        .map(|other| {
                                            view! {
                                                <MenuItem
                                                    actions
                                                    label=format!(
                                                        "Session {} · {}",
                                                        other.number,
                                                        session_when(other),
                                                    )
                                                    edit=BuilderEdit::SwapSessions {
                                                        session: id,
                                                        with_session: other.id,
                                                    }
                                                />
                                            }
                                        })
                                        .collect_view()
                                })
                        }}
                    </Menu>
                    <Menu
                        id=MenuId::Time(id)
                        actions
                        label="Edit Time"
                        whose=format!("Session {number}: ")
                        title="Edit Time"
                        role="dialog"
                    >
                        {move || {
                            let (date, start_time) = start.get_value();
                            view! { <TimeForm session=id date start_time data actions /> }
                        }}
                    </Menu>
                </div>
            </header>
            {session
                .groups
                .into_iter()
                .map(|group| view! { <GroupView session=id group data actions /> })
                .collect_view()}
        </article>
    }
}

#[component]
fn TimeForm(
    session: u32,
    date: String,
    start_time: String,
    data: BoardData,
    actions: BoardActions,
) -> impl IntoView {
    let days = data.options.with_value(|options| options.days.clone());
    let first_day = days.first().cloned();
    let chosen_date = RwSignal::new(if date.is_empty() {
        first_day
            .as_ref()
            .map(|day| day.date.clone())
            .unwrap_or_default()
    } else {
        date
    });
    let clock = start_time
        .get(..5)
        .map(str::to_owned)
        .unwrap_or_else(|| first_day.map(|day| day.first_start).unwrap_or_default());
    let chosen_time = RwSignal::new(clock);
    let problem = RwSignal::new(None::<&'static str>);
    let save = move || {
        let time = chosen_time.get_untracked();
        if !is_clock(&time) {
            problem.set(Some("Enter a start time."));
            return;
        }
        actions.open_menu.set(None);
        actions.add_edit.run(BuilderEdit::SetSessionTime {
            session,
            date: chosen_date.get_untracked(),
            start_time: time,
        });
    };
    view! {
        <form
            class="builder-time-form"
            novalidate=true
            on:submit=move |event| {
                event.prevent_default();
                save();
            }
        >
            <label class="builder-field">
                <span>"Date"</span>
                <select
                    class="builder-input"
                    prop:value=move || chosen_date.get()
                    on:change=move |event| chosen_date.set(event_target_value(&event))
                >
                    {days
                        .into_iter()
                        .map(|day| {
                            let label = format_us_date(&day.date);
                            view! { <option value=day.date>{label}</option> }
                        })
                        .collect_view()}
                </select>
            </label>
            <label class="builder-field">
                <span>"Start Time"</span>
                <input
                    class="builder-input"
                    type="time"
                    step="300"
                    prop:value=move || chosen_time.get()
                    on:input=move |event| {
                        chosen_time.set(event_target_value(&event));
                        problem.set(None);
                    }
                />
            </label>
            {move || {
                problem
                    .get()
                    .map(|message| {
                        view! { <p class="access-inline-error" role="alert">{message}</p> }
                    })
            }}
            <button class="builder-button" type="submit">"Save Time"</button>
        </form>
    }
}

fn athlete_count(count: usize) -> String {
    if count == 1 {
        "1 Athlete".to_owned()
    } else {
        format!("{count} Athletes")
    }
}

#[component]
fn GroupView(
    session: u32,
    group: BuiltGroup,
    data: BoardData,
    actions: BoardActions,
) -> impl IntoView {
    let platform = StoredValue::new(group.platform.clone());
    let count = athlete_count(group.athletes.len());
    view! {
        <section class="builder-group">
            <h4 class="builder-group-head">
                <span class="builder-platform">{group.platform.clone()}</span>
                <span class="builder-group-label">{group.label.clone()}</span>
                <span class="builder-group-count">{count}</span>
            </h4>
            <div class="builder-classes">
                {group
                    .weight_classes
                    .into_iter()
                    .map(|weight_class| {
                        let shown = display_weight_class(&weight_class);
                        let class_of_edit = StoredValue::new(weight_class.clone());
                        view! {
                            <Menu
                                id=MenuId::Class {
                                    session,
                                    platform: platform.get_value(),
                                    weight_class,
                                }
                                actions
                                label=shown.clone()
                                whose="Move Class: "
                                title="Move Class To…"
                                button_class="builder-chip"
                            >
                                {move || {
                                    let from_platform = platform.get_value();
                                    data.sessions
                                        .with_value(|sessions| {
                                            data.options
                                                .with_value(|options| {
                                                    move_targets(
                                                        sessions,
                                                        &options.platforms,
                                                        session,
                                                        &from_platform,
                                                    )
                                                })
                                        })
                                        .into_iter()
                                        .map(|target| {
                                            view! {
                                                <MenuItem
                                                    actions
                                                    label=target.label
                                                    edit=BuilderEdit::MoveClass {
                                                        from_session: session,
                                                        from_platform: from_platform.clone(),
                                                        weight_class: class_of_edit.get_value(),
                                                        to_session: target.session,
                                                        to_platform: target.platform,
                                                    }
                                                />
                                            }
                                        })
                                        .collect_view()
                                }}
                            </Menu>
                        }
                    })
                    .collect_view()}
            </div>
            <ol class="builder-athletes">
                {group
                    .athletes
                    .into_iter()
                    .map(|athlete| {
                        view! { <AthleteRow session platform=platform.get_value() athlete data actions /> }
                    })
                    .collect_view()}
            </ol>
        </section>
    }
}

fn athlete_details(athlete: &BuiltAthlete) -> String {
    let mut details = vec![
        format!("Age {}", athlete.age),
        display_weight_class(&athlete.weight_class),
        format!("Total {}", reference_value(Some(athlete.entry_total))),
    ];
    if !athlete.club.trim().is_empty() {
        details.push(athlete.club.trim().to_owned());
    }
    details.join(" · ")
}

#[component]
fn AthleteRow(
    session: u32,
    platform: String,
    athlete: BuiltAthlete,
    data: BoardData,
    actions: BoardActions,
) -> impl IntoView {
    let details = athlete_details(&athlete);
    let key = StoredValue::new(athlete.key.clone());
    let platform = StoredValue::new(platform);
    view! {
        <li class="builder-athlete">
            <div class="builder-athlete-text">
                <span class="builder-athlete-name">{athlete.name.clone()}</span>
                <span class="builder-athlete-detail">{details}</span>
            </div>
            <Menu
                id=MenuId::Athlete(athlete.key.clone())
                actions
                label="Move To…"
                whose=format!("{}: ", athlete.name)
                title="Move To…"
            >
                {move || {
                    let from_platform = platform.get_value();
                    data.sessions
                        .with_value(|sessions| {
                            data.options
                                .with_value(|options| {
                                    move_targets(sessions, &options.platforms, session, &from_platform)
                                })
                        })
                        .into_iter()
                        .map(|target| {
                            view! {
                                <MenuItem
                                    actions
                                    label=target.label
                                    edit=BuilderEdit::MoveAthlete {
                                        athlete: key.get_value(),
                                        to_session: target.session,
                                        to_platform: target.platform,
                                    }
                                />
                            }
                        })
                        .collect_view()
                }}
            </Menu>
        </li>
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn athlete_rows_read_age_class_total_and_club() {
        let athlete = BuiltAthlete {
            key: "1|ann".to_owned(),
            name: "Ann".to_owned(),
            age: 15.0,
            club: " Barbell Club ".to_owned(),
            weight_class: "48".to_owned(),
            entry_total: 100.0,
        };
        assert_eq!(
            athlete_details(&athlete),
            "Age 15 · 48kg · Total 100 · Barbell Club"
        );
        let unentered = BuiltAthlete {
            club: String::new(),
            entry_total: 0.0,
            ..athlete
        };
        assert_eq!(athlete_details(&unentered), "Age 15 · 48kg · Total —");
    }

    #[test]
    fn sessions_without_a_time_say_so() {
        let session = BuiltSession {
            id: 1,
            number: 1,
            date: "2026-11-14".to_owned(),
            start_time: "09:00:00".to_owned(),
            weigh_in_time: "07:00:00".to_owned(),
            groups: Vec::new(),
        };
        assert_eq!(
            session_times(&session),
            "November 14, 2026 · Weigh-In 7:00 AM · Start 9:00 AM"
        );
        assert_eq!(
            session_times(&BuiltSession {
                date: String::new(),
                start_time: String::new(),
                ..session
            }),
            "No Time"
        );
        assert_eq!(athlete_count(1), "1 Athlete");
        assert_eq!(athlete_count(3), "3 Athletes");
    }
}
