use super::board::alert_line;
use super::browser::local_date;
use super::models::{Publications, publication_status_label};
use crate::auth::{AuthContext, AuthState};
use crate::pages::comp_data::loading::{Load, LoadState, load_error};
use crate::utils::api::{
    self, Basis, BuilderEdit, BuilderOptions, PublishOutcome, PublishStatus, ScheduleBase,
};
use futures::future::{AbortHandle, abortable};
use leptos::prelude::*;
use leptos::task::spawn_local;

#[derive(Clone, Debug, PartialEq)]
enum Phase {
    Ready,
    Publishing,
    Published {
        outcome: PublishOutcome,
        options: BuilderOptions,
        edits: Vec<BuilderEdit>,
        basis: Basis,
    },
}

impl Phase {
    fn outcome_for(
        &self,
        options: Option<&BuilderOptions>,
        edits: &[BuilderEdit],
        basis: &Basis,
    ) -> Option<&PublishOutcome> {
        match self {
            Phase::Published {
                outcome,
                options: published,
                edits: published_edits,
                basis: published_basis,
            } if options == Some(published)
                && edits == published_edits.as_slice()
                && basis == published_basis =>
            {
                Some(outcome)
            }
            Phase::Ready | Phase::Publishing | Phase::Published { .. } => None,
        }
    }
}

fn after_publish(
    basis: Basis,
    edits: Vec<BuilderEdit>,
    outcome: &PublishOutcome,
) -> (Basis, Vec<BuilderEdit>) {
    if outcome.status == PublishStatus::Live {
        (
            Basis {
                base: ScheduleBase::Published,
                base_version: outcome.version.clone(),
            },
            Vec::new(),
        )
    } else {
        (basis, edits)
    }
}

#[component]
pub(crate) fn PublishPanel(
    meet: String,
    applied: RwSignal<Option<BuilderOptions>>,
    edits: RwSignal<Vec<BuilderEdit>>,
    basis: RwSignal<Basis>,
) -> impl IntoView {
    let auth = expect_context::<AuthContext>();
    let meet = StoredValue::new(meet);
    view! {
        <section
            class="builder-panel builder-publish no-print"
            aria-labelledby="builder-publish-heading"
        >
            <h2 id="builder-publish-heading">"Publish to MeetCal"</h2>
            {move || match auth.state.get() {
                AuthState::SignedIn(user) => {
                    view! { <SignedInPublish meet=meet.get_value() user applied edits basis /> }
                        .into_any()
                }
                AuthState::Loading => {
                    view! { <p class="data-status">"Checking your sign-in…"</p> }.into_any()
                }
                AuthState::SignedOut | AuthState::ConfigurationError(_) => {
                    view! {
                        <button
                            class="builder-button"
                            type="button"
                            disabled=matches!(
                                auth.state.get_untracked(),
                                AuthState::ConfigurationError(_)
                            )
                            on:click=move |_| auth.open_sign_in()
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
    basis: RwSignal<Basis>,
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
    let shown_outcome = Memo::new(move |_| {
        phase.with(|phase| {
            applied.with(|options| {
                edits.with(|edits| {
                    basis.with(|basis| phase.outcome_for(options.as_ref(), edits, basis).cloned())
                })
            })
        })
    });
    let publish = move || {
        let Some(options) = applied.get_untracked() else {
            return;
        };
        if publishing.get_untracked() {
            return;
        }
        let contact = email.get_untracked().trim().to_owned();
        let changes = edits.get_untracked();
        let sent_basis = basis.get_untracked();
        error.set(None);
        phase.set(Phase::Publishing);
        let (task, handle) = abortable(async move {
            let outcome = api::publish_schedule(
                &meet.get_value(),
                &options,
                &changes,
                &sent_basis,
                (!contact.is_empty()).then_some(contact.as_str()),
            )
            .await;
            outcome.map(|outcome| {
                let (basis, edits) = after_publish(sent_basis, changes, &outcome);
                Phase::Published {
                    outcome,
                    options,
                    edits,
                    basis,
                }
            })
        });
        in_flight.set_value(Some(handle));
        spawn_local(async move {
            let Ok(result) = task.await else {
                return;
            };
            match result {
                Ok(published) => {
                    if let Phase::Published {
                        edits: kept,
                        basis: kept_basis,
                        ..
                    } = &published
                        && basis.with_untracked(|basis| basis != kept_basis)
                    {
                        basis.try_set(kept_basis.clone());
                        edits.try_set(kept.clone());
                    }
                    phase.try_set(published);
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
        {move || match shown_outcome.get() {
            Some(outcome) => {
                let (heading, message) = published_message(&outcome);
                view! {
                    <div class="builder-published" role="status">
                        <h3>{heading}</h3>
                        <p>{message}</p>
                    </div>
                }
                    .into_any()
            }
            None => {
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
                        {move || alert_line(error.get(), "access-inline-error")}
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
                    LoadState::Loading => {
                        view! { <p class="data-status">"Loading your publishes…"</p> }.into_any()
                    }
                    LoadState::Failed(message) => {
                        load_error("your publishes", message, move || publications.retry())
                    }
                    LoadState::Ready(answer) => {
                        view! { <PublicationList answer=answer.clone() /> }.into_any()
                    }
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
            version: None,
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
            version: None,
        };
        assert_eq!(published_message(&pending).0, "Sent for Review");
    }

    #[test]
    fn a_publish_shows_until_the_schedule_changes() {
        let outcome = PublishOutcome {
            status: PublishStatus::Live,
            sessions: 2,
            athletes: 3,
            version: Some("p2".to_owned()),
        };
        let options = BuilderOptions {
            days: Vec::new(),
            session_minutes: 120,
            break_minutes: 0,
            max_athletes_per_platform: 15,
            max_sessions_per_day: None,
            platforms: vec!["Red".to_owned()],
            grouping: crate::utils::api::Grouping::WeightClass,
            separate_age_groups: true,
            order: crate::utils::api::SessionOrder::WomenThenMen,
        };
        let entries = Basis::default();
        let published = Phase::Published {
            outcome: outcome.clone(),
            options: options.clone(),
            edits: Vec::new(),
            basis: entries.clone(),
        };
        assert_eq!(
            published.outcome_for(Some(&options), &[], &entries),
            Some(&outcome)
        );
        let on_published = Basis {
            base: ScheduleBase::Published,
            base_version: None,
        };
        assert_eq!(
            published.outcome_for(Some(&options), &[], &on_published),
            None
        );
        let edit = BuilderEdit::SwapSessions {
            session: 1,
            with_session: 2,
        };
        assert_eq!(
            published.outcome_for(Some(&options), &[edit], &entries),
            None
        );
        let mut longer = options.clone();
        longer.session_minutes = 90;
        assert_eq!(published.outcome_for(Some(&longer), &[], &entries), None);
        assert_eq!(
            Phase::Ready.outcome_for(Some(&options), &[], &entries),
            None
        );
    }

    #[test]
    fn a_live_publish_makes_the_schedule_it_wrote_the_new_base() {
        let live = PublishOutcome {
            status: PublishStatus::Live,
            sessions: 2,
            athletes: 3,
            version: Some("p2".to_owned()),
        };
        let opened = Basis {
            base: ScheduleBase::Published,
            base_version: Some("p1".to_owned()),
        };
        let edit = BuilderEdit::SwapSessions {
            session: 1,
            with_session: 2,
        };
        assert_eq!(
            after_publish(opened.clone(), vec![edit.clone()], &live),
            (
                Basis {
                    base: ScheduleBase::Published,
                    base_version: Some("p2".to_owned())
                },
                Vec::new()
            )
        );
        let pending = PublishOutcome {
            status: PublishStatus::Pending,
            ..live.clone()
        };
        assert_eq!(
            after_publish(opened.clone(), vec![edit.clone()], &pending),
            (opened, vec![edit.clone()])
        );
        let from_scratch = Basis {
            base: ScheduleBase::Entries,
            base_version: Some("p1".to_owned()),
        };
        assert_eq!(
            after_publish(from_scratch, vec![edit.clone()], &live),
            (
                Basis {
                    base: ScheduleBase::Published,
                    base_version: Some("p2".to_owned())
                },
                Vec::new()
            )
        );
        assert_eq!(
            after_publish(Basis::default(), vec![edit.clone()], &pending),
            (Basis::default(), vec![edit])
        );
    }
}
