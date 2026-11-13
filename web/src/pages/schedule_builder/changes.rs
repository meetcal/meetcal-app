use super::board::{BoardActions, Menu, MenuId, alert_line, athlete_details, move_items};
use super::browser::local_date_time;
use super::models::{
    AddedEntrant, BuiltSchedule, MoveTarget, WithdrawnAthlete, added_note, place_targets,
    withdrawn_note,
};
use crate::utils::api::{self, BuilderEdit};
use leptos::prelude::*;
use leptos::task::spawn_local;

pub(crate) fn checked_label(checked_at: Option<f64>) -> String {
    checked_at.map_or_else(
        || "Not Checked Yet".to_owned(),
        |at| format!("Last Checked {}", local_date_time(at)),
    )
}

#[component]
pub(crate) fn Sport80Panel(
    board: RwSignal<Option<BuiltSchedule>>,
    platforms: Signal<Vec<String>>,
    sport80_link: Option<String>,
    checks: RwSignal<u64>,
    actions: BoardActions,
) -> impl IntoView {
    let checking = RwSignal::new(false);
    let problem = RwSignal::new(None::<String>);
    let no_link = sport80_link.is_none();
    let link = StoredValue::new(sport80_link.unwrap_or_default());
    let check = move |_| {
        if checking.get_untracked() {
            return;
        }
        checking.set(true);
        problem.set(None);
        spawn_local(async move {
            if let Err(error) = api::load_builder_meet(&link.get_value()).await {
                problem.try_set(Some(error.to_string()));
            } else {
                checks.try_update(|count| *count += 1);
            }
            checking.try_set(false);
        });
    };
    view! {
        <section
            class="builder-panel builder-changes no-print"
            aria-labelledby="builder-changes-heading"
            data-testid="sport80-changes"
        >
            <div class="builder-changes-head">
                <h2 id="builder-changes-heading">"Sport80 Changes"</h2>
                <span class="builder-list-meta">
                    {move || {
                        board
                            .with(|board| {
                                checked_label(
                                    board
                                        .as_ref()
                                        .and_then(|board| board.changes.as_ref())
                                        .and_then(|changes| changes.checked_at),
                                )
                            })
                    }}
                </span>
                <button
                    class="builder-button-quiet"
                    type="button"
                    hidden=no_link
                    disabled=move || checking.get()
                    on:click=check
                >
                    {move || if checking.get() { "Checking…" } else { "Check Sport80 Now" }}
                </button>
            </div>
            {move || alert_line(problem.get(), "access-inline-error")}
            {move || board.with(|board| change_lists(board.as_ref(), platforms, actions))}
        </section>
    }
}

fn change_lists(
    board: Option<&BuiltSchedule>,
    platforms: Signal<Vec<String>>,
    actions: BoardActions,
) -> AnyView {
    let Some((board, changes)) = board.and_then(|board| {
        board
            .changes
            .as_ref()
            .filter(|changes| changes.checked_at.is_some())
            .map(|changes| (board, changes))
    }) else {
        return ().into_any();
    };
    let targets = StoredValue::new(
        platforms.with_untracked(|platforms| place_targets(&board.sessions, platforms)),
    );
    let added = changes
        .added
        .iter()
        .enumerate()
        .map(|(row, entrant)| added_row(row, entrant, targets, actions))
        .collect_view();
    let withdrawn = changes
        .withdrawn
        .iter()
        .enumerate()
        .map(|(row, lifter)| withdrawn_row(row, lifter, actions))
        .collect_view();
    let withdrawn_text = withdrawn_note(changes.withdrawn.len());
    view! {
        <h3 class="builder-subheading">"New on Sport80"</h3>
        <p class="builder-help">{added_note(changes.added.len())}</p>
        <ul class="builder-list" aria-label="New on Sport80">
            {added}
        </ul>
        <h3 class="builder-subheading">"No Longer on Sport80"</h3>
        <p class="builder-help" hidden=withdrawn_text.is_empty()>
            {withdrawn_text}
        </p>
        <ul class="builder-list" aria-label="No Longer on Sport80">
            {withdrawn}
        </ul>
    }
    .into_any()
}

fn change_row(name: &str, meta: String, buttons: AnyView) -> AnyView {
    view! {
        <li class="builder-list-row">
            <span class="builder-match">
                <span class="builder-match-name">{name.to_owned()}</span>
                <span class="builder-list-meta">{meta}</span>
            </span>
            {buttons}
        </li>
    }
    .into_any()
}

fn edit_button(
    id: String,
    name: &str,
    label: String,
    edit: BuilderEdit,
    actions: BoardActions,
) -> AnyView {
    let pressed = id.clone();
    view! {
        <button
            id=id
            class="builder-button-quiet"
            type="button"
            on:click=move |_| actions.edit_from(&pressed, edit.clone())
        >
            <span class="visually-hidden">{format!("{name}: ")}</span>
            {label}
        </button>
    }
    .into_any()
}

fn added_row(
    row: usize,
    entrant: &AddedEntrant,
    targets: StoredValue<Vec<MoveTarget>>,
    actions: BoardActions,
) -> AnyView {
    let athlete = &entrant.athlete;
    let key = StoredValue::new(athlete.key.clone());
    let add_to = move |session: u32, platform: String| BuilderEdit::AddAthlete {
        athlete: key.get_value(),
        to_session: session,
        to_platform: platform,
    };
    let suggested = entrant.suggestion.as_ref().map(|place| {
        edit_button(
            format!("builder-add-{row}"),
            &athlete.name,
            format!("Add to {}", place.label()),
            add_to(place.session, place.platform.clone()),
            actions,
        )
    });
    let menu_trigger = StoredValue::new(format!("builder-add-to-{row}"));
    let buttons = view! {
        {suggested}
        <Menu
            id=MenuId::Add(athlete.key.clone())
            open_menu=actions.open_menu
            trigger_id=menu_trigger.get_value()
            label="Add To…"
            whose=format!("{}: ", athlete.name)
            title="Add To…"
        >
            {move || {
                move_items(
                    targets.get_value(),
                    menu_trigger.get_value(),
                    actions,
                    move |target| add_to(target.session, target.platform),
                )
            }}
        </Menu>
    };
    change_row(&athlete.name, athlete_details(athlete), buttons.into_any())
}

fn withdrawn_row(row: usize, lifter: &WithdrawnAthlete, actions: BoardActions) -> AnyView {
    let athlete = &lifter.athlete;
    let remove = edit_button(
        format!("builder-remove-{row}"),
        &athlete.name,
        "Remove".to_owned(),
        BuilderEdit::RemoveAthlete {
            athlete: athlete.key.clone(),
            from_session: lifter.place.session,
            from_platform: lifter.place.platform.clone(),
            occurrence: lifter.occurrence,
        },
        actions,
    );
    change_row(&athlete.name, lifter.place.label(), remove)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_meet_never_checked_says_so() {
        assert_eq!(checked_label(None), "Not Checked Yet");
    }
}
