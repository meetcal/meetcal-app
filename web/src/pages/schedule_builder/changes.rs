use super::board::{
    BoardActions, Menu, MenuId, alert_line, athlete_details, edit_button, move_items,
};
use super::browser::local_date_time;
use super::models::{AddedEntrant, BuiltSchedule, MoveTarget, cooldown_note, place_targets};
use crate::utils::api::{self, BuilderEdit};
use leptos::prelude::*;
use leptos::task::spawn_local;

pub(crate) fn checked_label(checked_at: Option<f64>) -> String {
    checked_at.map_or_else(
        || "Not Checked Yet".to_owned(),
        |at| format!("Last Checked {}", local_date_time(at)),
    )
}

pub(crate) fn sport80_panel(
    board: RwSignal<Option<BuiltSchedule>>,
    platforms: Signal<Vec<String>>,
    sport80_link: Option<String>,
    checks: RwSignal<u64>,
    publishing: RwSignal<bool>,
    actions: BoardActions,
) -> AnyView {
    let checking = RwSignal::new(false);
    let problem = RwSignal::new(None::<String>);
    let cooldown = RwSignal::new(None::<String>);
    let no_link = sport80_link.is_none();
    let link = StoredValue::new(sport80_link.unwrap_or_default());
    let check = move |_| {
        if checking.get_untracked() {
            return;
        }
        checking.set(true);
        problem.set(None);
        cooldown.set(None);
        spawn_local(async move {
            match api::load_builder_meet(&link.get_value()).await {
                Err(error) => {
                    problem.try_set(Some(error.to_string()));
                }
                Ok(loaded) => {
                    if let (false, Some(checked_at), Some(next_check_at)) =
                        (loaded.refreshed, loaded.checked_at, loaded.next_check_at)
                    {
                        cooldown.try_set(Some(cooldown_note(
                            &local_date_time(checked_at),
                            &local_date_time(next_check_at),
                        )));
                    }
                    checks.try_update(|count| *count += 1);
                }
            }
            checking.try_set(false);
        });
    };
    view! {
        <section
            class="builder-panel builder-changes no-print"
            inert=publishing
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
            <p class="builder-help" role="status">
                {move || cooldown.get()}
            </p>
            {move || board.with(|board| change_lists(board.as_ref(), platforms, actions))}
        </section>
    }
    .into_any()
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
    view! {
        <h3 class="builder-subheading">"New on Sport80"</h3>
        <p class="builder-help">{changes.added_note.clone()}</p>
        <ul class="builder-list" aria-label="New on Sport80">
            {added}
        </ul>
        <h3 class="builder-subheading">"No Longer on Sport80"</h3>
        <p class="builder-help">{changes.withdrawn_note.clone()}</p>
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
    view! {
        <li class="builder-list-row">
            <span class="builder-match">
                <span class="builder-match-name">{athlete.name.clone()}</span>
                <span class="builder-list-meta">{athlete_details(athlete)}</span>
            </span>
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
        </li>
    }
    .into_any()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_meet_never_checked_says_so() {
        assert_eq!(checked_label(None), "Not Checked Yet");
    }
}
