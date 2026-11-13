use super::board::alert_line;
use super::browser::{local_date, remove_local_work};
use super::models::DraftSummary;
use crate::auth::{AuthContext, AuthState};
use crate::pages::comp_data::loading::{Load, select_response};
use crate::utils::api;
use leptos::prelude::*;
use leptos::task::spawn_local;

pub(crate) fn builder_path(meet: &str) -> String {
    let encoded = js_sys::encode_uri_component(meet)
        .as_string()
        .unwrap_or_default();
    format!("/schedule-builder?meet={encoded}")
}

#[component]
pub(crate) fn SavedSchedules() -> impl IntoView {
    let auth = expect_context::<AuthContext>();
    move || match auth.state.get() {
        AuthState::SignedIn(user) => Some(view! { <DraftList user /> }),
        AuthState::Loading | AuthState::SignedOut | AuthState::ConfigurationError(_) => None,
    }
}

#[component]
fn DraftList(user: String) -> impl IntoView {
    let refreshes = RwSignal::new(0_u64);
    let drafts = Load::new(
        move || (user.clone(), refreshes.get()),
        |_: (String, u64)| async move {
            api::builder_drafts::<Vec<DraftSummary>>()
                .await
                .map_err(|error| error.to_string())
        },
    );
    let deleting = RwSignal::new(None::<String>);
    let error = RwSignal::new(None::<String>);
    let delete = move |meet: String| {
        if deleting.with_untracked(Option::is_some) {
            return;
        }
        error.set(None);
        deleting.set(Some(meet.clone()));
        spawn_local(async move {
            match api::delete_builder_draft(&meet).await {
                Ok(()) => {
                    remove_local_work(&meet);
                    refreshes.try_update(|count| *count += 1);
                }
                Err(message) => {
                    error.try_set(Some(message.to_string()));
                }
            }
            deleting.try_set(None);
        });
    };
    view! {
        <section class="builder-panel builder-drafts" aria-labelledby="builder-drafts-heading">
            <h2 id="builder-drafts-heading">"Saved Schedules"</h2>
            {move || alert_line(error.get(), "access-inline-error")}
            {move || {
                select_response(
                    drafts,
                    "Loading your saved schedules…",
                    "your saved schedules",
                    |rows| {
                        if rows.is_empty() {
                            return view! { <p class="builder-help">"No saved schedules yet."</p> }
                                .into_any();
                        }
                        view! {
                            <ul class="builder-list">
                                {rows
                                    .iter()
                                    .map(|draft| {
                                        let meet = draft.meet.clone();
                                        let label = meet.clone();
                                        let busy = meet.clone();
                                        view! {
                                            <li class="builder-list-row">
                                                <a class="builder-list-link" href=builder_path(&draft.meet)>
                                                    {draft.meet.clone()}
                                                </a>
                                                <span class="builder-list-meta">
                                                    {format!("Saved {}", local_date(draft.updated_at))}
                                                </span>
                                                <button
                                                    type="button"
                                                    class="builder-button-quiet"
                                                    aria-label=format!("Delete the saved schedule for {label}")
                                                    disabled=move || {
                                                        deleting
                                                            .with(|deleting| deleting.as_deref() == Some(busy.as_str()))
                                                    }
                                                    on:click=move |_| delete(meet.clone())
                                                >
                                                    "Delete"
                                                </button>
                                            </li>
                                        }
                                    })
                                    .collect_view()}
                            </ul>
                        }
                            .into_any()
                    },
                )
            }}
        </section>
    }
}
