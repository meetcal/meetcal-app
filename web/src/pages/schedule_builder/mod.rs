mod board;
mod browser;
mod changes;
mod drafts;
mod form;
mod models;
mod publish;

use crate::auth::{AuthContext, AuthState};
use crate::pages::comp_data::loading::{Load, LoadState, load_error};
use crate::utils::api::{
    self, Basis, BuilderEdit, BuilderOptions, ExportFormat, MeetMatches, ScheduleBase,
};
use board::{Board, BoardActions, Menu, MenuId, UNDO_BUTTON_ID, alert_line};
use browser::{
    focus_element, now_ms, print_page, read_local_work, save_download, write_local_work,
};
use changes::sport80_panel;
use drafts::{SavedSchedules, builder_path};
use form::{BUILD_BUTTON_ID, OptionsPanel};
use futures::future::{AbortHandle, abortable};
use leptos::prelude::*;
use leptos::task::spawn_local;
use leptos_router::components::A;
use leptos_router::hooks::{use_navigate, use_query_map};
use models::{
    BuiltSchedule, Defaults, LocalWork, MAX_BUILDER_EDITS, SET_ASIDE_NOTICE, SavedDraft, Start,
    checked_options, form_of, is_sport80_link, match_details, rebuild_warning, starting_point,
    unbuilt_message,
};
use publish::PublishPanel;

#[component]
pub fn ScheduleBuilderPage() -> impl IntoView {
    let query = use_query_map();
    let meet = Memo::new(move |_| {
        query.with(|params| params.get("meet").unwrap_or_default().trim().to_owned())
    });
    let open_menu = RwSignal::new(None::<MenuId>);
    let escape = StoredValue::new_local(None::<WindowListenerHandle>);
    Effect::new(move |_| {
        escape.set_value(Some(window_event_listener(
            leptos::ev::keydown,
            move |event| {
                if event.key() == "Escape" {
                    open_menu.set(None);
                }
            },
        )));
    });
    on_cleanup(move || {
        if let Some(listener) = escape.try_update_value(Option::take).flatten() {
            listener.remove();
        }
    });
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Finding {
    Idle,
    Searching,
    Loading,
}

#[component]
fn LoadForm() -> impl IntoView {
    let navigate = StoredValue::new_local(use_navigate());
    let typed = RwSignal::new(String::new());
    let finding = RwSignal::new(Finding::Idle);
    let error = RwSignal::new(None::<String>);
    let found = RwSignal::new(None::<(String, MeetMatches)>);
    let in_flight = StoredValue::new_local(None::<AbortHandle>);
    let cancel = move || {
        if let Some(request) = in_flight.try_update_value(Option::take).flatten() {
            request.abort();
        }
    };
    on_cleanup(cancel);
    let loading = move || finding.get() == Finding::Loading;
    let load = move |link: String| {
        cancel();
        error.set(None);
        finding.set(Finding::Loading);
        let (task, handle) = abortable(async move { api::load_builder_meet(&link).await });
        in_flight.set_value(Some(handle));
        spawn_local(async move {
            let Ok(result) = task.await else {
                return;
            };
            finding.try_set(Finding::Idle);
            match result {
                Ok(loaded) => navigate.with_value(|navigate| {
                    navigate(&builder_path(&loaded.meet), Default::default());
                }),
                Err(message) => {
                    error.try_set(Some(message.to_string()));
                }
            }
        });
    };
    let search = move |query: String| {
        cancel();
        error.set(None);
        found.set(None);
        finding.set(Finding::Searching);
        let (task, handle) = abortable(async move {
            let answer = api::search_builder_meets(&query).await;
            (query, answer)
        });
        in_flight.set_value(Some(handle));
        spawn_local(async move {
            let Ok((query, answer)) = task.await else {
                return;
            };
            finding.try_set(Finding::Idle);
            match answer {
                Ok(matches) => {
                    found.try_set(Some((query, matches)));
                }
                Err(message) => {
                    error.try_set(Some(message.to_string()));
                }
            }
        });
    };
    let submit = move || {
        if finding.get_untracked() == Finding::Loading {
            return;
        }
        let text = typed.get_untracked().trim().to_owned();
        if text.is_empty() {
            found.set(None);
            error.set(Some(
                "Type the meet’s name or paste its Sport80 link.".to_owned(),
            ));
        } else if is_sport80_link(&text) {
            found.set(None);
            load(text);
        } else {
            search(text);
        }
    };
    view! {
        <section class="builder-panel builder-load" aria-labelledby="builder-load-heading">
            <h2 id="builder-load-heading">"Load a Meet"</h2>
            <form
                class="builder-load-form"
                novalidate=true
                aria-busy=move || (finding.get() != Finding::Idle).then_some("true")
                on:submit=move |event| {
                    event.prevent_default();
                    submit();
                }
            >
                <label class="builder-field builder-load-field">
                    <span>"Sport80 Link or Meet Name"</span>
                    <input
                        class="builder-input"
                        type="text"
                        enterkeyhint="search"
                        autocomplete="off"
                        placeholder="Turkey Cup or https://usaweightlifting.sport80.com/public/events/12345"
                        disabled=loading
                        prop:value=move || typed.get()
                        on:input=move |event| typed.set(event_target_value(&event))
                    />
                </label>
                <button class="builder-button" type="submit" disabled=loading>
                    {move || {
                        if loading() {
                            "Loading…"
                        } else if typed.with(|text| is_sport80_link(text)) {
                            "Load"
                        } else {
                            "Search"
                        }
                    }}
                </button>
            </form>
            <p class="builder-progress" role="status" aria-live="polite">
                {move || match finding.get() {
                    Finding::Searching => "Searching Sport80’s upcoming meets…",
                    Finding::Loading => "Reading the meet’s entries from Sport80…",
                    Finding::Idle => "",
                }}
            </p>
            {move || alert_line(error.get(), "access-inline-error builder-error")}
            {move || {
                found
                    .get()
                    .map(|(query, matches)| {
                        view! { <MeetMatchList query matches loading=Signal::derive(loading) on_load=load /> }
                    })
            }}
        </section>
    }
}

#[component]
fn MeetMatchList(
    query: String,
    matches: MeetMatches,
    loading: Signal<bool>,
    on_load: impl Fn(String) + Copy + 'static,
) -> impl IntoView {
    if matches.results.is_empty() {
        return view! {
            <p class="builder-help builder-matches-empty">
                {format!("No upcoming Sport80 meets match “{query}”.")}
            </p>
        }
        .into_any();
    }
    view! {
        <ul class="builder-list builder-matches" aria-label="Matching Meets">
            {matches
                .results
                .into_iter()
                .map(|found| {
                    let details = match_details(&found);
                    let label = if details.is_empty() {
                        format!("Load {}", found.name)
                    } else {
                        format!("Load {}, {details}", found.name)
                    };
                    view! {
                        <li class="builder-list-row">
                            <span class="builder-match">
                                <span class="builder-match-name">{found.name}</span>
                                <span class="builder-list-meta">{details}</span>
                            </span>
                            {match found.entries_url {
                                Some(link) => {
                                    view! {
                                        <button
                                            class="builder-button-quiet"
                                            type="button"
                                            aria-label=label
                                            disabled=move || loading.get()
                                            on:click=move |_| on_load(link.clone())
                                        >
                                            "Load"
                                        </button>
                                    }
                                        .into_any()
                                }
                                None => {
                                    view! {
                                        <span class="builder-list-meta builder-match-missing">
                                            "No Entry List Yet"
                                        </span>
                                    }
                                        .into_any()
                                }
                            }}
                        </li>
                    }
                })
                .collect_view()}
        </ul>
        {matches
            .truncated
            .then(|| {
                view! {
                    <p class="builder-help builder-matches-more">
                        "Sport80 has more matches than these. Add more of the name to narrow them."
                    </p>
                }
            })}
    }
    .into_any()
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
        let start = starting_point(&defaults, saved, local);
        let notice = notice.or_else(|| start.set_aside.then(|| SET_ASIDE_NOTICE.to_owned()));
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
    let sport80_link = defaults.sport80_link;
    let applied = RwSignal::new(start.built.then(|| start.options.clone()));
    let edits = RwSignal::new(start.edits);
    let basis = RwSignal::new(start.basis);
    let on_published =
        Memo::new(move |_| basis.with(|basis| basis.base == ScheduleBase::Published));
    let checks = RwSignal::new(0_u64);
    let form_error = RwSignal::new(None::<String>);
    let edit_error = RwSignal::new(None::<String>);
    let pending_rebuild = RwSignal::new(None::<BuilderOptions>);
    let replaced = RwSignal::new(None::<(BuilderOptions, Vec<BuilderEdit>, Basis)>);

    Effect::new(move |previous: Option<()>| {
        let options = applied.get();
        let changes = edits.get();
        let basis = basis.get();
        let rebuilding = replaced.with(Option::is_some);
        if previous.is_none() || rebuilding {
            return;
        }
        if let Some(options) = options {
            write_local_work(
                &meet.get_value(),
                &LocalWork {
                    options,
                    edits: changes,
                    basis,
                    saved_at: now_ms(),
                },
            );
        }
    });

    let preview = Load::new(
        move || {
            applied.get().map(|options| {
                (
                    meet.get_value(),
                    options,
                    edits.get(),
                    basis.get(),
                    checks.get(),
                )
            })
        },
        |request: Option<(String, BuilderOptions, Vec<BuilderEdit>, Basis, u64)>| async move {
            match request {
                Some((meet, options, edits, basis, _)) => {
                    api::builder_preview::<BuiltSchedule>(&meet, &options, &edits, basis.base)
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
        if replaced.with_untracked(Option::is_none)
            && let Some(previous) = applied.get_untracked()
        {
            replaced.set(Some((
                previous,
                edits.get_untracked(),
                basis.get_untracked(),
            )));
        }
        edits.set(Vec::new());
        basis.set(Basis::default());
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
                if let Some((options, kept, kept_basis)) = replaced.get_untracked() {
                    replaced.set(None);
                    form_error.set(Some(unbuilt_message(kept.len(), message)));
                    edits.set(kept);
                    basis.set(kept_basis);
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
        if on_published.get_untracked() {
            pending_rebuild.set(Some(options));
            return;
        }
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
        if on_published.get() {
            "Rebuild From Scratch"
        } else if applied.with(Option::is_none) {
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
        {alert_line(notice, "access-inline-error no-print")}
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
                    let count = edits.with_untracked(Vec::len);
                    let published = on_published.get_untracked();
                    let options = StoredValue::new(options);
                    view! {
                        <div
                            class="builder-confirm no-print"
                            role="alertdialog"
                            aria-label=if published {
                                "Rebuild from scratch?"
                            } else {
                                "Discard your edits?"
                            }
                        >
                            <p>{rebuild_warning(published, count)}</p>
                            <div class="builder-confirm-actions">
                                <button
                                    class="builder-button"
                                    type="button"
                                    on:click=move |_| {
                                        apply(options.get_value());
                                        focus_element(BUILD_BUTTON_ID);
                                    }
                                >
                                    {if published {
                                        "Rebuild From Scratch"
                                    } else {
                                        "Discard Edits and Build"
                                    }}
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
        {move || {
            on_published
                .get()
                .then(|| {
                    sport80_panel(
                        last_board,
                        Signal::derive(move || {
                            applied
                                .with(|applied| {
                                    applied.as_ref().map(|o| o.platforms.clone()).unwrap_or_default()
                                })
                        }),
                        sport80_link.clone(),
                        checks,
                        actions,
                    )
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
                <Toolbar meet applied edits basis open_menu />
                {move || alert_line(edit_error.get(), "access-inline-error no-print")}
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
            <PublishPanel meet=meet.get_value() applied edits basis />
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
                                on:click=move |_| auth.open_sign_in()
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
    Saved(BuilderOptions, Vec<BuilderEdit>, Basis),
}

const EXPORT_BUTTON_ID: &str = "builder-export";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ExportChoice {
    Csv,
    Excel,
    Pdf,
}

impl ExportChoice {
    const ALL: [Self; 3] = [Self::Csv, Self::Excel, Self::Pdf];

    fn label(self) -> &'static str {
        match self {
            Self::Csv => "CSV",
            Self::Excel => "Excel",
            Self::Pdf => "PDF",
        }
    }

    fn file_format(self) -> Option<ExportFormat> {
        match self {
            Self::Csv => Some(ExportFormat::Csv),
            Self::Excel => Some(ExportFormat::Xlsx),
            Self::Pdf => None,
        }
    }
}

fn preparing_label(format: ExportFormat) -> &'static str {
    match format {
        ExportFormat::Csv => "Preparing the CSV…",
        ExportFormat::Xlsx => "Preparing the Excel workbook…",
    }
}

#[component]
fn Toolbar(
    meet: StoredValue<String>,
    applied: RwSignal<Option<BuilderOptions>>,
    edits: RwSignal<Vec<BuilderEdit>>,
    basis: RwSignal<Basis>,
    open_menu: RwSignal<Option<MenuId>>,
) -> impl IntoView {
    let auth = expect_context::<AuthContext>();
    let exporting = RwSignal::new(None::<ExportFormat>);
    let problem = RwSignal::new(None::<String>);
    let draft = RwSignal::new(DraftSave::Idle);
    let download =
        move |format: ExportFormat| {
            let Some(options) = applied.get_untracked() else {
                return;
            };
            if exporting.with_untracked(Option::is_some) {
                return;
            }
            let changes = edits.get_untracked();
            let base = basis.with_untracked(|basis| basis.base);
            problem.set(None);
            exporting.set(Some(format));
            spawn_local(async move {
                let saved =
                    match api::builder_export(&meet.get_value(), &options, &changes, base, format)
                        .await
                    {
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
            DraftSave::Saved(options, saved_edits, saved_basis) => {
                applied.with(|applied| applied.as_ref() == Some(options))
                    && edits.with(|edits| edits == saved_edits)
                    && basis.with(|basis| basis == saved_basis)
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
        let kept_basis = basis.get_untracked();
        problem.set(None);
        draft.set(DraftSave::Saving);
        spawn_local(async move {
            match api::save_builder_draft(&meet.get_value(), &options, &changes, &kept_basis).await
            {
                Ok(()) => {
                    draft.try_set(DraftSave::Saved(options, changes, kept_basis));
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
            <span class="builder-toolbar-status" role="status">
                {move || exporting.get().map(preparing_label)}
            </span>
            <div class="builder-export">
                <Menu
                    id=MenuId::Export
                    open_menu
                    trigger_id=EXPORT_BUTTON_ID
                    label="Export"
                    title="Export"
                    button_class="builder-button-quiet"
                >
                    {move || {
                        ExportChoice::ALL
                            .into_iter()
                            .map(|choice| {
                                view! {
                                    <li>
                                        <button
                                            type="button"
                                            class="builder-menu-item"
                                            disabled=move || {
                                                choice.file_format().is_some()
                                                    && exporting.with(Option::is_some)
                                            }
                                            on:click=move |_| {
                                                open_menu.set(None);
                                                focus_element(EXPORT_BUTTON_ID);
                                                match choice.file_format() {
                                                    Some(format) => download(format),
                                                    None => print_page(),
                                                }
                                            }
                                        >
                                            {choice.label()}
                                        </button>
                                    </li>
                                }
                            })
                            .collect_view()
                    }}
                </Menu>
            </div>
        </div>
        {move || alert_line(problem.get(), "access-inline-error no-print")}
    }
}
