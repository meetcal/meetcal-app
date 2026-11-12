use super::browser::local_date;
use super::models::{Publications, publication_status_label};
use crate::auth::{AuthContext, AuthState, open_clerk_sign_in};
use crate::pages::comp_data::loading::{Load, LoadState, load_error};
use crate::utils::api::{self, BuilderEdit, BuilderOptions, PublishOutcome, PublishStatus};
use futures::future::{AbortHandle, abortable};
use leptos::prelude::*;
use leptos::task::spawn_local;

#[derive(Clone, Debug, PartialEq)]
enum Phase {
    Ready,
    Publishing,
    Published(PublishOutcome),
}

#[component]
pub(crate) fn PublishPanel(
    meet: String,
    applied: RwSignal<Option<BuilderOptions>>,
    edits: RwSignal<Vec<BuilderEdit>>,
) -> impl IntoView {
    let auth = expect_context::<AuthContext>();
    let meet = StoredValue::new(meet);
    view! {
        <section class="builder-panel builder-publish no-print" aria-labelledby="builder-publish-heading">
            <h2 id="builder-publish-heading">"Publish to MeetCal"</h2>
            {move || match auth.state.get() {
                AuthState::SignedIn(user) => {
                    view! { <SignedInPublish meet=meet.get_value() user applied edits /> }.into_any()
                }
                AuthState::Loading => {
                    view! { <p class="data-status">"Checking your sign-in…"</p> }.into_any()
                }
                AuthState::SignedOut | AuthState::ConfigurationError(_) => {
                    view! {
                        <p class="builder-help">
                            "Publishing puts this schedule on MeetCal for every lifter and coach at the meet."
                        </p>
                        <button
                            class="builder-button"
                            type="button"
                            disabled=matches!(auth.state.get_untracked(), AuthState::ConfigurationError(_))
                            on:click=move |_| open_clerk_sign_in()
                        >
                            "Sign In to Publish"
                        </button>
                    }
                        .into_any()
                }
            }}
        </section>
    }
}

fn published_message(outcome: &PublishOutcome) -> (&'static str, String) {
    let sessions = if outcome.sessions == 1 {
        "1 session".to_owned()
    } else {
        format!("{} sessions", outcome.sessions)
    };
    let athletes = if outcome.athletes == 1 {
        "1 athlete".to_owned()
    } else {
        format!("{} athletes", outcome.athletes)
    };
    match outcome.status {
        PublishStatus::Live => (
            "Live on MeetCal",
            format!("{sessions} and {athletes} are on MeetCal now."),
        ),
        PublishStatus::Pending => (
            "Sent for Review",
            format!("MeetCal will review the {sessions} and {athletes} before they go live."),
        ),
    }
}

#[component]
fn SignedInPublish(
    meet: String,
    user: String,
    applied: RwSignal<Option<BuilderOptions>>,
    edits: RwSignal<Vec<BuilderEdit>>,
) -> impl IntoView {
    let refreshes = RwSignal::new(0_u64);
    let meet = StoredValue::new(meet);
    let publications = Load::new(
        move || (meet.get_value(), user.clone(), refreshes.get()),
        |(meet, _, _): (String, String, u64)| async move {
            api::schedule_publications::<Publications>(&meet)
                .await
                .map_err(|error| error.to_string())
        },
    );
    let email = RwSignal::new(crate::auth::primary_email().unwrap_or_default());
    let phase = RwSignal::new(Phase::Ready);
    let error = RwSignal::new(None::<String>);
    let in_flight = StoredValue::new_local(None::<AbortHandle>);
    on_cleanup(move || {
        if let Some(publish) = in_flight.try_update_value(Option::take).flatten() {
            publish.abort();
        }
    });
    let publishing = Memo::new(move |_| phase.get() == Phase::Publishing);
    let publish = move || {
        let Some(options) = applied.get_untracked() else {
            return;
        };
        if publishing.get_untracked() {
            return;
        }
        let contact = email.get_untracked().trim().to_owned();
        let changes = edits.get_untracked();
        error.set(None);
        phase.set(Phase::Publishing);
        let (task, handle) = abortable(async move {
            api::publish_schedule(
                &meet.get_value(),
                &options,
                &changes,
                (!contact.is_empty()).then_some(contact.as_str()),
            )
            .await
        });
        in_flight.set_value(Some(handle));
        spawn_local(async move {
            let Ok(result) = task.await else {
                return;
            };
            match result {
                Ok(outcome) => {
                    phase.try_set(Phase::Published(outcome));
                    refreshes.try_update(|count| *count += 1);
                }
                Err(message) => {
                    error.try_set(Some(message.to_string()));
                    phase.try_set(Phase::Ready);
                }
            }
        });
    };
    view! {
        {move || match phase.get() {
            Phase::Published(outcome) => {
                let (heading, message) = published_message(&outcome);
                view! {
                    <div class="builder-published" role="status">
                        <h3>{heading}</h3>
                        <p>{message}</p>
                    </div>
                }
                    .into_any()
            }
            Phase::Ready | Phase::Publishing => {
                view! {
                    <form
                        class="builder-publish-form"
                        novalidate=true
                        on:submit=move |event| {
                            event.prevent_default();
                            publish();
                        }
                    >
                        <label class="builder-field">
                            <span>"Contact Email"</span>
                            <input
                                class="builder-input"
                                type="email"
                                autocomplete="email"
                                prop:value=move || email.get()
                                on:input=move |event| email.set(event_target_value(&event))
                            />
                        </label>
                        {move || {
                            error
                                .get()
                                .map(|message| {
                                    view! { <p class="access-inline-error" role="alert">{message}</p> }
                                })
                        }}
                        <button
                            class="builder-button"
                            type="submit"
                            disabled=move || publishing.get() || applied.with(Option::is_none)
                        >
                            {move || if publishing.get() { "Publishing…" } else { "Publish" }}
                        </button>
                    </form>
                }
                    .into_any()
            }
        }}
        {move || {
            publications
                .with(|state| match state {
                    LoadState::Loading => view! { <p class="data-status">"Loading your publishes…"</p> }.into_any(),
                    LoadState::Failed(message) => {
                        load_error("your publishes", message, move || publications.retry())
                    }
                    LoadState::Ready(answer) => view! { <PublicationList answer=answer.clone() /> }.into_any(),
                })
        }}
    }
}

#[component]
fn PublicationList(answer: Publications) -> impl IntoView {
    let standing = if answer.organizer {
        "You organize this meet, so your publishes go live at once."
    } else {
        "A meet’s first publish is reviewed before it goes live; once it’s approved, you organize the meet and later publishes go live at once."
    };
    view! {
        <p class="builder-help">{standing}</p>
        {(!answer.publications.is_empty())
            .then(|| {
                view! {
                    <h3 class="builder-subheading">"Your Publishes"</h3>
                    <ul class="builder-list">
                        {answer
                            .publications
                            .into_iter()
                            .map(|publication| {
                                view! {
                                    <li class="builder-list-row" data-id=publication.id>
                                        <span class="builder-status-pill">
                                            {publication_status_label(&publication.status)}
                                        </span>
                                        <span>{local_date(publication.created_at)}</span>
                                    </li>
                                }
                            })
                            .collect_view()}
                    </ul>
                }
            })}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_answer_says_whether_the_schedule_is_live() {
        let live = PublishOutcome {
            status: PublishStatus::Live,
            sessions: 4,
            athletes: 1,
        };
        assert_eq!(
            published_message(&live),
            (
                "Live on MeetCal",
                "4 sessions and 1 athlete are on MeetCal now.".to_owned()
            )
        );
        let pending = PublishOutcome {
            status: PublishStatus::Pending,
            sessions: 1,
            athletes: 17,
        };
        assert_eq!(published_message(&pending).0, "Sent for Review");
    }
}
