mod board;
mod browser;
mod drafts;
mod form;
mod models;
mod publish;

use crate::auth::{AuthContext, AuthState, open_clerk_sign_in};
use crate::pages::comp_data::loading::{Load, LoadState, load_error};
use crate::utils::api::{self, BuilderEdit, BuilderOptions, ExportFormat};
use board::{Board, BoardActions, MenuId, UNDO_BUTTON_ID};
use browser::{
    focus_element, now_ms, print_page, read_local_work, save_download, write_local_work,
};
use drafts::{SavedSchedules, builder_path};
use form::{BUILD_BUTTON_ID, OptionsPanel};
use futures::future::{AbortHandle, abortable};
use leptos::prelude::*;
use leptos::task::spawn_local;
use leptos_router::components::A;
use leptos_router::hooks::{use_navigate, use_query_map};
use models::{
    BuiltSchedule, Defaults, LocalWork, MAX_BUILDER_EDITS, SavedDraft, Start, checked_options,
    form_of, starting_point,
};
use publish::PublishPanel;

#[component]
pub fn ScheduleBuilderPage() -> impl IntoView {
    let query = use_query_map();
    let meet = Memo::new(move |_| {
        query.with(|params| params.get("meet").unwrap_or_default().trim().to_owned())
    });
    let open_menu = RwSignal::new(None::<MenuId>);
    let escape = window_event_listener(leptos::ev::keydown, move |event| {
        if event.key() == "Escape" {
            open_menu.set(None);
        }
    });
    on_cleanup(move || escape.remove());
    view! {
        <section class="data-page builder-page">
            <div class="builder-intro no-print">
                <h1>"Schedule Builder"</h1>
            </div>
            {move || {
                let meet = meet.get();
                if meet.is_empty() {
                    view! {
                        <LoadForm />
                        <SavedSchedules />
                    }
                        .into_any()
                } else {
                    view! { <Workspace meet open_menu /> }.into_any()
                }
            }}
        </section>
    }
}

#[component]
fn LoadForm() -> impl IntoView {
    let navigate = use_navigate();
    let url = RwSignal::new(String::new());
    let loading = RwSignal::new(false);
    let error = RwSignal::new(None::<String>);
    let in_flight = StoredValue::new_local(None::<AbortHandle>);
    on_cleanup(move || {
        if let Some(load) = in_flight.try_update_value(Option::take).flatten() {
            load.abort();
        }
    });
    let submit = move || {
        if loading.get_untracked() {
            return;
        }
        let pasted = url.get_untracked().trim().to_owned();
        if pasted.is_empty() {
            error.set(Some("Paste the meet’s Sport80 entries URL.".to_owned()));
            return;
        }
        error.set(None);
        loading.set(true);
        let navigate = navigate.clone();
        let (task, handle) = abortable(async move { api::load_builder_meet(&pasted).await });
        in_flight.set_value(Some(handle));
        spawn_local(async move {
            let Ok(result) = task.await else {
                return;
            };
            loading.try_set(false);
            match result {
                Ok(loaded) => navigate(&builder_path(&loaded.meet), Default::default()),
                Err(message) => {
                    error.try_set(Some(message.to_string()));
                }
            }
        });
    };
    view! {
        <section class="builder-panel builder-load" aria-labelledby="builder-load-heading">
            <h2 id="builder-load-heading">"Load a Meet"</h2>
            <form
                class="builder-load-form"
                novalidate=true
                aria-busy=move || loading.get().then_some("true")
                on:submit=move |event| {
                    event.prevent_default();
                    submit();
                }
            >
                <label class="builder-field builder-load-field">
                    <span>"Sport80 Entries URL"</span>
                    <input
                        class="builder-input"
                        type="url"
                        inputmode="url"
                        autocomplete="off"
                        placeholder="https://usaweightlifting.sport80.com/public/events/12345/entries/67890"
                        disabled=move || loading.get()
                        prop:value=move || url.get()
                        on:input=move |event| url.set(event_target_value(&event))
                    />
                </label>
                <button class="builder-button" type="submit" disabled=move || loading.get()>
                    {move || if loading.get() { "Loading…" } else { "Load" }}
                </button>
            </form>
            <p class="builder-progress" role="status" aria-live="polite">
                {move || {
                    if loading.get() { "Reading the meet’s entries from Sport80…" } else { "" }
                }}
            </p>
            {move || {
                error
                    .get()
                    .map(|message| {
                        view! {
                            <p class="access-inline-error builder-error" role="alert">
                                {message}
                            </p>
                        }
                    })
            }}
        </section>
    }
}

#[derive(Clone, Debug, PartialEq)]
enum DraftKey {
    Waiting,
    SignedOut,
    SignedIn(String),
}

#[derive(Clone, Debug, PartialEq)]
struct Opened {
    defaults: Defaults,
    start: Start,
    notice: Option<String>,
}

#[component]
fn Workspace(meet: String, open_menu: RwSignal<Option<MenuId>>) -> impl IntoView {
    let auth = expect_context::<AuthContext>();
    let meet = StoredValue::new(meet);
    let defaults = Load::new(
        move || meet.get_value(),
        |meet: String| async move {
            api::builder_defaults::<Defaults>(&meet)
                .await
                .map_err(|error| error.to_string())
        },
    );
    let draft = Load::new(
        move || match auth.state.get() {
            AuthState::Loading => DraftKey::Waiting,
            AuthState::SignedIn(user) => DraftKey::SignedIn(user),
            AuthState::SignedOut | AuthState::ConfigurationError(_) => DraftKey::SignedOut,
        },
        move |key: DraftKey| async move {
            match key {
                DraftKey::SignedIn(_) => {
                    api::builder_draft::<Option<SavedDraft>>(&meet.get_value())
                        .await
                        .map_err(|error| error.to_string())
                }
                DraftKey::Waiting | DraftKey::SignedOut => Ok(None),
            }
        },
    );
    let waiting_for_auth = Memo::new(move |_| auth.state.get() == AuthState::Loading);
    let opened = RwSignal::new(None::<Opened>);
    Effect::new(move |_| {
        if opened.with_untracked(Option::is_some) || waiting_for_auth.get() {
            return;
        }
        let Some(defaults) = defaults.with(|state| match state {
            LoadState::Ready(defaults) => Some(defaults.clone()),
            LoadState::Loading | LoadState::Failed(_) => None,
        }) else {
            return;
        };
        let Some((saved, notice)) = draft.with(|state| match state {
            LoadState::Loading => None,
            LoadState::Ready(saved) => Some((saved.clone(), None)),
            LoadState::Failed(message) => Some((
                None,
                Some(format!("Your saved draft couldn’t be loaded: {message}")),
            )),
        }) else {
            return;
        };
        let local = read_local_work(&meet.get_value());
        let start = starting_point(&defaults.options, saved, local);
        opened.set(Some(Opened {
            defaults,
            start,
            notice,
        }));
    });
    view! {
        <Show
            when=move || opened.with(Option::is_some)
            fallback=move || {
                defaults
                    .with(|state| match state {
                        LoadState::Failed(message) => {
                            load_error("the meet", message, move || defaults.retry())
                        }
                        LoadState::Loading | LoadState::Ready(_) => {
                            view! {
                                <p class="data-status" role="status">
                                    "Loading the meet…"
                                </p>
                            }
                                .into_any()
                        }
                    })
            }
        >
            {move || { opened.get_untracked().map(|opened| view! { <Editor opened open_menu /> }) }}
        </Show>
    }
}

#[component]
fn Editor(opened: Opened, open_menu: RwSignal<Option<MenuId>>) -> impl IntoView {
    let auth = expect_context::<AuthContext>();
    let Opened {
        defaults,
        start,
        notice,
    } = opened;
    let meet = StoredValue::new(defaults.meet.clone());
    let meet_name = defaults.meet.clone();
    let form = RwSignal::new(form_of(&defaults.options.days, &start.options));
    let meet_defaults = StoredValue::new(defaults.options);
    let applied = RwSignal::new(start.built.then(|| start.options.clone()));
    let edits = RwSignal::new(start.edits);
    let form_error = RwSignal::new(None::<String>);
    let edit_error = RwSignal::new(None::<String>);
    let pending_rebuild = RwSignal::new(None::<BuilderOptions>);
    let replaced = RwSignal::new(None::<(BuilderOptions, Vec<BuilderEdit>)>);

    Effect::new(move |previous: Option<()>| {
        let options = applied.get();
        let changes = edits.get();
        if previous.is_none() || replaced.with_untracked(Option::is_some) {
            return;
        }
        if let Some(options) = options {
            write_local_work(
                &meet.get_value(),
                &LocalWork {
                    options,
                    edits: changes,
                    saved_at: now_ms(),
                },
            );
        }
    });

    let preview = Load::new(
        move || {
            applied
                .get()
                .map(|options| (meet.get_value(), options, edits.get()))
        },
        |request: Option<(String, BuilderOptions, Vec<BuilderEdit>)>| async move {
            match request {
                Some((meet, options, edits)) => {
                    api::builder_preview::<BuiltSchedule>(&meet, &options, &edits)
                        .await
                        .map(Some)
                        .map_err(|error| error.to_string())
                }
                None => Ok(None),
            }
        },
    );
    let last_board = RwSignal::new(None::<BuiltSchedule>);
    Effect::new(move |_| {
        preview.with(|state| {
            if let LoadState::Ready(Some(schedule)) = state {
                last_board.set(Some(schedule.clone()));
            }
        });
    });

    let apply = move |options: BuilderOptions| {
        pending_rebuild.set(None);
        edit_error.set(None);
        if let Some(previous) = applied.get_untracked() {
            replaced.set(Some((previous, edits.get_untracked())));
        }
        edits.set(Vec::new());
        applied.set(Some(options));
    };
    Effect::new(move |_| {
        preview.with(|state| match state {
            LoadState::Ready(_) => {
                if replaced.with_untracked(Option::is_some) {
                    replaced.set(None);
                }
            }
            LoadState::Failed(message) => {
                if let Some((options, kept)) = replaced.get_untracked() {
                    replaced.set(None);
                    form_error.set(Some(format!(
                        "This schedule couldn’t be built, so your edits are kept: {message}"
                    )));
                    edits.set(kept);
                    applied.set(Some(options));
                }
            }
            LoadState::Loading => {}
        });
    });
    let build = move || {
        let options = match checked_options(&form.get_untracked()) {
            Ok(options) => options,
            Err(message) => {
                form_error.set(Some(message));
                return;
            }
        };
        form_error.set(None);
        if applied.with_untracked(|applied| applied.as_ref() == Some(&options)) {
            pending_rebuild.set(None);
            preview.retry_failed();
            return;
        }
        if applied.with_untracked(Option::is_none) || edits.with_untracked(Vec::is_empty) {
            apply(options);
        } else {
            pending_rebuild.set(Some(options));
        }
    };
    let build_label = Signal::derive(move || {
        if applied.with(Option::is_none) {
            "Build Schedule"
        } else {
            "Build Again"
        }
    });
    let add_edit = Callback::new(move |edit: BuilderEdit| {
        if edits.with_untracked(Vec::len) >= MAX_BUILDER_EDITS {
            edit_error.set(Some(format!(
                "A schedule holds at most {MAX_BUILDER_EDITS} edits. Build again to start over."
            )));
            return false;
        }
        edit_error.set(None);
        edits.update(|edits| edits.push(edit));
        true
    });
    let actions = BoardActions {
        open_menu,
        add_edit,
        focus_after_edit: RwSignal::new(None),
    };
    let keep_editing = NodeRef::<leptos::html::Button>::new();
    Effect::new(move || {
        if let Some(button) = keep_editing.get() {
            let _ = button.focus();
        }
    });

    view! {
        <div class="builder-meet-head">
            <h2 class="builder-meet-name">{meet_name}</h2>
            <A href="/schedule-builder" attr:class="builder-button-quiet no-print">
                "Load Another Meet"
            </A>
        </div>
        {notice
            .map(|message| {
                view! {
                    <p class="access-inline-error no-print" role="alert">
                        {message}
                    </p>
                }
            })}
        <OptionsPanel
            form
            on_build=move |()| build()
            build_label
            error=Signal::derive(move || form_error.get())
        />
        {move || {
            pending_rebuild
                .get()
                .map(|options| {
                    let count = edits.with(Vec::len);
                    let options = StoredValue::new(options);
                    view! {
                        <div
                            class="builder-confirm no-print"
                            role="alertdialog"
                            aria-label="Discard your edits?"
                        >
                            <p>
                                {if count == 1 {
                                    "Building again discards your edit.".to_owned()
                                } else {
                                    format!("Building again discards your {count} edits.")
                                }}
                            </p>
                            <div class="builder-confirm-actions">
                                <button
                                    class="builder-button"
                                    type="button"
                                    on:click=move |_| {
                                        apply(options.get_value());
                                        focus_element(BUILD_BUTTON_ID);
                                    }
                                >
                                    "Discard Edits and Build"
                                </button>
                                <button
                                    class="builder-button-quiet"
                                    type="button"
                                    node_ref=keep_editing
                                    on:click=move |_| {
                                        pending_rebuild.set(None);
                                        focus_element(BUILD_BUTTON_ID);
                                    }
                                >
                                    "Keep Editing"
                                </button>
                            </div>
                        </div>
                    }
                })
        }}
        <Show when=move || applied.with(Option::is_some)>
            <section class="builder-sessions" aria-labelledby="builder-sessions-heading">
                <div class="builder-sessions-head">
                    <h2 id="builder-sessions-heading">"Sessions"</h2>
                    <p class="builder-totals">
                        {move || {
                            last_board
                                .with(|board| {
                                    board
                                        .as_ref()
                                        .map(|board| {
                                            format!(
                                                "{} Athletes · {} Sessions",
                                                board.athletes,
                                                board.sessions.len(),
                                            )
                                        })
                                })
                        }}
                    </p>
                </div>
                <Toolbar meet applied edits />
                {move || {
                    edit_error
                        .get()
                        .map(|message| {
                            view! {
                                <p class="access-inline-error no-print" role="alert">
                                    {message}
                                </p>
                            }
                        })
                }}
                {move || {
                    let options = applied
                        .get_untracked()
                        .unwrap_or_else(|| meet_defaults.get_value());
                    preview
                        .with(|state| match state {
                            LoadState::Loading => {
                                match last_board.get_untracked() {
                                    Some(schedule) => {
                                        view! {
                                            <Warnings schedule=schedule.clone() />
                                            <Board schedule options busy=true actions />
                                        }
                                            .into_any()
                                    }
                                    None => {
                                        view! {
                                            <p class="data-status" role="status">
                                                "Building the schedule…"
                                            </p>
                                        }
                                            .into_any()
                                    }
                                }
                            }
                            LoadState::Failed(message) => {
                                load_error("the schedule", message, move || preview.retry())
                            }
                            LoadState::Ready(None) => ().into_any(),
                            LoadState::Ready(Some(schedule)) => {
                                view! {
                                    <Warnings schedule=schedule.clone() />
                                    <Board schedule=schedule.clone() options busy=false actions />
                                }
                                    .into_any()
                            }
                        })
                }}
            </section>
            <PublishPanel meet=meet.get_value() applied edits />
        </Show>
        {move || {
            matches!(auth.state.get(), AuthState::SignedOut)
                .then(|| {
                    view! {
                        <p class="builder-help no-print">
                            "This browser keeps your schedule. "
                            <button
                                class="builder-link-button"
                                type="button"
                                on:click=move |_| open_clerk_sign_in()
                            >
                                "Sign in"
                            </button> " to save a draft you can open anywhere."
                        </p>
                    }
                })
        }}
    }
}

#[component]
fn Warnings(schedule: BuiltSchedule) -> impl IntoView {
    (!schedule.warnings.is_empty()).then(|| {
        view! {
            <ul class="builder-warnings" aria-label="Warnings">
                {schedule
                    .warnings
                    .into_iter()
                    .map(|warning| view! { <li data-code=warning.code>{warning.message}</li> })
                    .collect_view()}
            </ul>
        }
    })
}

#[derive(Clone, Debug, PartialEq)]
enum DraftSave {
    Idle,
    Saving,
    Saved(BuilderOptions, Vec<BuilderEdit>),
}

#[component]
fn Toolbar(
    meet: StoredValue<String>,
    applied: RwSignal<Option<BuilderOptions>>,
    edits: RwSignal<Vec<BuilderEdit>>,
) -> impl IntoView {
    let auth = expect_context::<AuthContext>();
    let exporting = RwSignal::new(None::<ExportFormat>);
    let problem = RwSignal::new(None::<String>);
    let draft = RwSignal::new(DraftSave::Idle);
    let download = move |format: ExportFormat| {
        let Some(options) = applied.get_untracked() else {
            return;
        };
        if exporting.with_untracked(Option::is_some) {
            return;
        }
        let changes = edits.get_untracked();
        problem.set(None);
        exporting.set(Some(format));
        spawn_local(async move {
            let saved =
                match api::builder_export(&meet.get_value(), &options, &changes, format).await {
                    Ok(file) => save_download(&file),
                    Err(error) => Err(error.to_string()),
                };
            if let Err(message) = saved {
                problem.try_set(Some(message));
            }
            exporting.try_set(None);
        });
    };
    let is_saved = Memo::new(move |_| {
        draft.with(|draft| match draft {
            DraftSave::Saved(options, saved_edits) => {
                applied.with(|applied| applied.as_ref() == Some(options))
                    && edits.with(|edits| edits == saved_edits)
            }
            DraftSave::Idle | DraftSave::Saving => false,
        })
    });
    let save_draft = move || {
        let Some(options) = applied.get_untracked() else {
            return;
        };
        if draft.with_untracked(|draft| *draft == DraftSave::Saving) {
            return;
        }
        let changes = edits.get_untracked();
        problem.set(None);
        draft.set(DraftSave::Saving);
        spawn_local(async move {
            match api::save_builder_draft(&meet.get_value(), &options, &changes).await {
                Ok(()) => {
                    draft.try_set(DraftSave::Saved(options, changes));
                }
                Err(error) => {
                    problem.try_set(Some(error.to_string()));
                    draft.try_set(DraftSave::Idle);
                }
            }
        });
    };
    view! {
        <div class="builder-toolbar no-print" role="toolbar" aria-label="Schedule actions">
            <button
                id=UNDO_BUTTON_ID
                class="builder-button-quiet"
                type="button"
                disabled=move || edits.with(Vec::is_empty)
                on:click=move |_| {
                    edits
                        .update(|edits| {
                            edits.pop();
                        })
                }
            >
                "Undo"
            </button>
            {move || {
                matches!(auth.state.get(), AuthState::SignedIn(_))
                    .then(|| {
                        view! {
                            <button
                                class="builder-button-quiet"
                                type="button"
                                disabled=move || {
                                    is_saved.get()
                                        || draft.with(|draft| *draft == DraftSave::Saving)
                                }
                                on:click=move |_| save_draft()
                            >
                                {move || {
                                    if draft.with(|draft| *draft == DraftSave::Saving) {
                                        "Saving…"
                                    } else if is_saved.get() {
                                        "Saved"
                                    } else {
                                        "Save Draft"
                                    }
                                }}
                            </button>
                        }
                    })
            }}
            <span class="builder-toolbar-spacer"></span>
            <button
                class="builder-button-quiet"
                type="button"
                disabled=move || exporting.with(Option::is_some)
                on:click=move |_| download(ExportFormat::Csv)
            >
                {move || {
                    if exporting.get() == Some(ExportFormat::Csv) {
                        "Preparing…"
                    } else {
                        "Download CSV"
                    }
                }}
            </button>
            <button
                class="builder-button-quiet"
                type="button"
                disabled=move || exporting.with(Option::is_some)
                on:click=move |_| download(ExportFormat::Xlsx)
            >
                {move || {
                    if exporting.get() == Some(ExportFormat::Xlsx) {
                        "Preparing…"
                    } else {
                        "Download Excel"
                    }
                }}
            </button>
            <button class="builder-button-quiet" type="button" on:click=move |_| print_page()>
                "Print / Save as PDF"
            </button>
        </div>
        {move || {
            problem
                .get()
                .map(|message| {
                    view! {
                        <p class="access-inline-error no-print" role="alert">
                            {message}
                        </p>
                    }
                })
        }}
    }
}
