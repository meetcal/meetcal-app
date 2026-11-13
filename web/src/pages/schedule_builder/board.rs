use super::browser::focus_element;
use super::models::{
    BuiltAthlete, BuiltGroup, BuiltSchedule, BuiltSession, MoveTarget, is_clock, move_targets,
    session_when,
};
use crate::pages::comp_data::format::{
    display_weight_class, format_us_date, format_us_time, reference_value,
};
use crate::utils::api::{BuilderEdit, BuilderOptions};
use leptos::prelude::*;

pub(crate) const UNDO_BUTTON_ID: &str = "builder-undo";

pub(crate) fn alert_line(message: Option<String>, class: &'static str) -> Option<AnyView> {
    message.map(|message| {
        view! {
            <p class=class role="alert">
                {message}
            </p>
        }
        .into_any()
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum MenuId {
    Athlete {
        session: u32,
        platform: String,
        row: usize,
        key: String,
    },
    Class {
        session: u32,
        platform: String,
        weight_class: String,
    },
    Swap(u32),
    Time(u32),
    Add(String),
    Export,
}

#[derive(Clone, Copy)]
pub(crate) struct BoardActions {
    pub open_menu: RwSignal<Option<MenuId>>,
    pub add_edit: Callback<BuilderEdit, bool>,
    pub focus_after_edit: RwSignal<Option<String>>,
}

impl BoardActions {
    pub(crate) fn edit_from(self, trigger_id: &str, edit: BuilderEdit) {
        self.open_menu.set(None);
        focus_element(trigger_id);
        if self.add_edit.run(edit) {
            self.focus_after_edit.set(Some(trigger_id.to_owned()));
        }
    }
}

#[derive(Clone, Copy)]
struct BoardData {
    sessions: StoredValue<Vec<BuiltSession>>,
    options: StoredValue<BuilderOptions>,
}

impl BoardData {
    fn move_targets(self, session: u32, from_platform: &str) -> Vec<MoveTarget> {
        self.sessions.with_value(|sessions| {
            self.options.with_value(|options| {
                move_targets(sessions, &options.platforms, session, from_platform)
            })
        })
    }
}

pub(crate) fn move_items(
    targets: Vec<MoveTarget>,
    trigger_id: String,
    actions: BoardActions,
    edit_for: impl Fn(MoveTarget) -> BuilderEdit,
) -> impl IntoView {
    targets
        .into_iter()
        .map(|target| {
            let label = target.label.clone();
            view! { <MenuItem actions trigger_id=trigger_id.clone() label edit=edit_for(target) /> }
        })
        .collect_view()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MenuKind {
    List,
    Dialog,
}

#[component]
pub(crate) fn Menu(
    id: MenuId,
    open_menu: RwSignal<Option<MenuId>>,
    #[prop(into)] trigger_id: String,
    #[prop(into)] label: String,
    #[prop(into, optional)] whose: String,
    #[prop(into)] title: String,
    #[prop(default = "builder-menu-button")] button_class: &'static str,
    #[prop(default = MenuKind::List)] kind: MenuKind,
    children: ChildrenFn,
) -> impl IntoView {
    let is_open = {
        let id = id.clone();
        Memo::new(move |_| open_menu.with(|open| open.as_ref() == Some(&id)))
    };
    let trigger = NodeRef::<leptos::html::Button>::new();
    let close = move || {
        open_menu.set(None);
        if let Some(button) = trigger.get_untracked() {
            let _ = button.focus();
        }
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
        <div
            class="builder-menu no-print"
            on:keydown=move |event| {
                if event.key() == "Escape" && is_open.get_untracked() {
                    event.stop_propagation();
                    close();
                }
            }
        >
            <button
                type="button"
                id=trigger_id
                class=button_class
                node_ref=trigger
                aria-haspopup=(kind == MenuKind::Dialog).then_some("dialog")
                aria-expanded=move || if is_open.get() { "true" } else { "false" }
                on:click=toggle
            >
                <span class="visually-hidden">{whose}</span>
                {label}
            </button>
            <Show when=move || is_open.get()>
                <div class="builder-menu-backdrop" on:click=move |_| close()></div>
                <div
                    class="builder-menu-panel"
                    role=if kind == MenuKind::Dialog { "dialog" } else { "group" }
                    aria-label=title.get_value()
                >
                    <p class="builder-menu-title">{title.get_value()}</p>
                    {match kind {
                        MenuKind::List => {
                            view! {
                                <ul class="builder-menu-list">
                                    {children.with_value(|children| children())}
                                </ul>
                            }
                                .into_any()
                        }
                        MenuKind::Dialog => children.with_value(|children| children()).into_any(),
                    }}
                </div>
            </Show>
        </div>
    }
}

#[component]
fn MenuItem(
    actions: BoardActions,
    #[prop(into)] trigger_id: String,
    #[prop(into)] label: String,
    edit: BuilderEdit,
) -> impl IntoView {
    let edit = StoredValue::new(edit);
    let trigger_id = StoredValue::new(trigger_id);
    view! {
        <li>
            <button
                type="button"
                class="builder-menu-item"
                on:click=move |_| {
                    actions.edit_from(&trigger_id.get_value(), edit.get_value());
                }
            >
                {label}
            </button>
        </li>
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
    if !busy {
        let focus_after_edit = actions.focus_after_edit;
        Effect::new(move || {
            let Some(trigger_id) = focus_after_edit.get_untracked() else {
                return;
            };
            focus_after_edit.set(None);
            if !focus_element(&trigger_id) {
                focus_element(UNDO_BUTTON_ID);
            }
        });
    }
    view! {
        <div
            class="builder-board"
            class:builder-board-busy=busy
            aria-busy=busy.then_some("true")
            inert=busy
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
    let swap_trigger = StoredValue::new(format!("builder-swap-{id}"));
    let time_trigger = StoredValue::new(format!("builder-time-{id}"));
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
                        open_menu=actions.open_menu
                        trigger_id=swap_trigger.get_value()
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
                                                    trigger_id=swap_trigger.get_value()
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
                        open_menu=actions.open_menu
                        trigger_id=time_trigger.get_value()
                        label="Edit Time"
                        whose=format!("Session {number}: ")
                        title="Edit Time"
                        kind=MenuKind::Dialog
                    >
                        {move || {
                            let (date, start_time) = start.get_value();
                            view! {
                                <TimeForm
                                    session=id
                                    date
                                    start_time
                                    trigger_id=time_trigger.get_value()
                                    data
                                    actions
                                />
                            }
                        }}
                    </Menu>
                </div>
            </header>
            {session
                .groups
                .into_iter()
                .enumerate()
                .map(|(index, group)| view! { <GroupView session=id index group data actions /> })
                .collect_view()}
        </article>
    }
}

#[component]
fn TimeForm(
    session: u32,
    date: String,
    start_time: String,
    trigger_id: String,
    data: BoardData,
    actions: BoardActions,
) -> impl IntoView {
    let date_field = NodeRef::<leptos::html::Select>::new();
    Effect::new(move || {
        if let Some(field) = date_field.get() {
            let _ = field.focus();
        }
    });
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
        actions.edit_from(
            &trigger_id,
            BuilderEdit::SetSessionTime {
                session,
                date: chosen_date.get_untracked(),
                start_time: time,
            },
        );
    };
    let shown_date = chosen_date.get_untracked();
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
                    node_ref=date_field
                    prop:value=move || chosen_date.get()
                    on:change=move |event| chosen_date.set(event_target_value(&event))
                >
                    {days
                        .into_iter()
                        .map(|day| {
                            let label = format_us_date(&day.date);
                            let selected = day.date == shown_date;
                            view! {
                                <option value=day.date selected=selected>
                                    {label}
                                </option>
                            }
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
            {move || alert_line(problem.get().map(str::to_owned), "access-inline-error")}
            <button class="builder-button" type="submit">
                "Save Time"
            </button>
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
    index: usize,
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
                    .enumerate()
                    .map(|(position, weight_class)| {
                        let shown = chip_label(&weight_class);
                        let class_of_edit = StoredValue::new(weight_class.clone());
                        let trigger_id = StoredValue::new(
                            format!("builder-class-{session}-{index}-{position}"),
                        );
                        view! {
                            <Menu
                                id=MenuId::Class {
                                    session,
                                    platform: platform.get_value(),
                                    weight_class,
                                }
                                open_menu=actions.open_menu
                                trigger_id=trigger_id.get_value()
                                label=shown.clone()
                                whose="Move Class: "
                                title="Move Class To…"
                                button_class="builder-chip"
                            >
                                {move || {
                                    let from_platform = platform.get_value();
                                    move_items(
                                        data.move_targets(session, &from_platform),
                                        trigger_id.get_value(),
                                        actions,
                                        move |target| BuilderEdit::MoveClass {
                                            from_session: session,
                                            from_platform: from_platform.clone(),
                                            weight_class: class_of_edit.get_value(),
                                            to_session: target.session,
                                            to_platform: target.platform,
                                        },
                                    )
                                }}
                            </Menu>
                        }
                    })
                    .collect_view()}
            </div>
            <ol class="builder-athletes">
                {group
                    .athletes
                    .iter()
                    .enumerate()
                    .map(|(row, athlete)| {
                        let trigger_id = format!("builder-athlete-{session}-{index}-{row}");
                        view! {
                            <AthleteRow
                                session
                                platform=platform.get_value()
                                row
                                occurrence=occurrence_of(&group.athletes, row)
                                trigger_id
                                athlete=athlete.clone()
                                data
                                actions
                            />
                        }
                    })
                    .collect_view()}
            </ol>
        </section>
    }
}

fn chip_label(weight_class: &str) -> String {
    let shown = display_weight_class(weight_class);
    shown
        .strip_suffix("kg")
        .map_or_else(|| shown.clone(), str::to_owned)
}

fn occurrence_of(athletes: &[BuiltAthlete], row: usize) -> u32 {
    let Some(athlete) = athletes.get(row) else {
        return 0;
    };
    let earlier = athletes
        .iter()
        .take(row)
        .filter(|other| other.key == athlete.key)
        .count();
    u32::try_from(earlier).unwrap_or(u32::MAX)
}

fn athlete_menu_id(session: u32, platform: &str, row: usize, athlete: &BuiltAthlete) -> MenuId {
    MenuId::Athlete {
        session,
        platform: platform.to_owned(),
        row,
        key: athlete.key.clone(),
    }
}

pub(crate) fn athlete_details(athlete: &BuiltAthlete) -> String {
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
    row: usize,
    occurrence: u32,
    trigger_id: String,
    athlete: BuiltAthlete,
    data: BoardData,
    actions: BoardActions,
) -> impl IntoView {
    let details = athlete_details(&athlete);
    let withdrawn = athlete.withdrawn;
    let menu_id = athlete_menu_id(session, &platform, row, &athlete);
    let key = StoredValue::new(athlete.key.clone());
    let platform = StoredValue::new(platform);
    let trigger = StoredValue::new(trigger_id);
    view! {
        <li class="builder-athlete">
            <div class="builder-athlete-text">
                <span class="builder-athlete-name">{athlete.name.clone()}</span>
                <span class="builder-athlete-detail">{details}</span>
                {withdrawn
                    .then(|| {
                        view! {
                            <span class="builder-status-pill builder-withdrawn">
                                "No Longer on Sport80"
                            </span>
                        }
                    })}
            </div>
            <Menu
                id=menu_id
                open_menu=actions.open_menu
                trigger_id=trigger.get_value()
                label="Move To…"
                whose=format!("{}: ", athlete.name)
                title="Move To…"
            >
                {move || {
                    move_items(
                        data.move_targets(session, &platform.get_value()),
                        trigger.get_value(),
                        actions,
                        move |target| BuilderEdit::MoveAthlete {
                            athlete: key.get_value(),
                            from_session: Some(session),
                            from_platform: Some(platform.get_value()),
                            occurrence: Some(occurrence),
                            to_session: target.session,
                            to_platform: target.platform,
                        },
                    )
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
            withdrawn: false,
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
    fn class_chips_read_as_the_group_labels_do() {
        assert_eq!(chip_label("45"), "45");
        assert_eq!(chip_label("61+"), "61+");
        assert_eq!(chip_label("+95"), "95+");
        assert_eq!(chip_label("69kg"), "69");
    }

    #[test]
    fn entrants_sharing_an_identity_get_their_own_menus() {
        let twin = BuiltAthlete {
            key: "3|mia lee".to_owned(),
            name: "Mia Lee".to_owned(),
            age: 40.0,
            club: String::new(),
            weight_class: "77".to_owned(),
            entry_total: 120.0,
            withdrawn: false,
        };
        let first = athlete_menu_id(2, "Red", 0, &twin);
        assert_ne!(first, athlete_menu_id(2, "Red", 1, &twin));
        assert_ne!(first, athlete_menu_id(2, "Blue", 0, &twin));
        assert_ne!(first, athlete_menu_id(1, "Red", 0, &twin));
        assert_eq!(first, athlete_menu_id(2, "Red", 0, &twin));
    }

    #[test]
    fn a_move_names_which_of_the_entrants_sharing_an_identity_it_takes() {
        let lifter = |key: &str| BuiltAthlete {
            key: key.to_owned(),
            name: "Mia Lee".to_owned(),
            age: 40.0,
            club: String::new(),
            weight_class: "77".to_owned(),
            entry_total: 120.0,
            withdrawn: false,
        };
        let group = [lifter("3|mia lee"), lifter("4|ann"), lifter("3|mia lee")];
        assert_eq!(
            (0..group.len())
                .map(|row| occurrence_of(&group, row))
                .collect::<Vec<_>>(),
            [0, 0, 1]
        );
        assert_eq!(occurrence_of(&group, 9), 0);
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
