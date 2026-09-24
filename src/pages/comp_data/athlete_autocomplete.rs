use super::models::{AthleteSearchQuery, AthleteSearchResponse};
use crate::utils::api::get_api_response_with_query;
use leptos::leptos_dom::helpers::{TimeoutHandle, set_timeout_with_handle};
use leptos::prelude::*;
use leptos::task::spawn_local;
use std::time::Duration;

/// Quiet period after the last keystroke before athlete suggestions are requested.
pub(crate) const SUGGESTION_DEBOUNCE: Duration = Duration::from_millis(250);
/// Shortest trimmed input that triggers a suggestion search.
const MIN_SUGGESTION_CHARS: usize = 3;

/// The trimmed text to search for, or `None` when the input is too short.
fn suggestion_query(input: &str) -> Option<String> {
    let trimmed = input.trim();
    (trimmed.chars().count() >= MIN_SUGGESTION_CHARS).then(|| trimmed.to_owned())
}

/// Numbers suggestion requests so only the newest one may publish results.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct RequestSequence {
    latest: u64,
}

impl RequestSequence {
    /// Starts a new request, making every earlier one stale.
    fn next(&mut self) -> u64 {
        self.latest += 1;
        self.latest
    }

    fn is_current(&self, request: u64) -> bool {
        self.latest == request
    }
}

#[derive(Clone, Debug, PartialEq)]
enum Suggestions {
    Idle,
    Searching,
    Ready(Vec<String>),
    Failed,
}

#[component]
pub(crate) fn AthleteAutocomplete(
    value: ReadSignal<String>,
    set_value: WriteSignal<String>,
    input_id: &'static str,
    #[prop(default = "")] wrapper_class: &'static str,
) -> impl IntoView {
    let (suggestions, set_suggestions) = signal(Suggestions::Idle);
    let sequence = StoredValue::new(RequestSequence::default());
    let pending_search = StoredValue::new(None::<TimeoutHandle>);

    let cancel_pending_search = move || {
        if let Some(handle) = pending_search.try_update_value(Option::take).flatten() {
            handle.clear();
        }
    };
    on_cleanup(cancel_pending_search);

    // Every input change starts a new request number, so a response for an
    // older query is discarded even if it arrives after a newer one.
    let schedule_search = move |input: &str| {
        cancel_pending_search();
        let Some(request) = sequence.try_update_value(RequestSequence::next) else {
            return;
        };
        let Some(query) = suggestion_query(input) else {
            set_suggestions.set(Suggestions::Idle);
            return;
        };
        set_suggestions.set(Suggestions::Searching);

        let search = move || {
            spawn_local(async move {
                let response = get_api_response_with_query::<AthleteSearchResponse, _>(
                    "/search",
                    &AthleteSearchQuery::suggestions(query),
                )
                .await;
                let is_current = sequence
                    .try_with_value(|sequence| sequence.is_current(request))
                    .unwrap_or(false);
                if is_current {
                    set_suggestions.try_set(match response {
                        Ok(response) => Suggestions::Ready(response.suggestions),
                        Err(_) => Suggestions::Failed,
                    });
                }
            });
        };
        if let Ok(handle) = set_timeout_with_handle(search, SUGGESTION_DEBOUNCE) {
            pending_search.set_value(Some(handle));
        }
    };

    view! {
        <div class=format!("athlete-autocomplete {wrapper_class}")>
            <label for=input_id>"Athlete"</label>
            <input
                id=input_id
                class="data-filter"
                type="search"
                required=true
                autocomplete="off"
                aria-autocomplete="list"
                aria-controls=format!("{input_id}-suggestions")
                placeholder="Athlete name"
                prop:value=move || value.get()
                on:input=move |event| {
                    let next = event_target_value(&event);
                    schedule_search(&next);
                    set_value.set(next);
                }
            />
            {move || {
                suggestions.with(|state| match state {
                    Suggestions::Idle | Suggestions::Failed => ().into_any(),
                    Suggestions::Searching => view! {
                        <div id=format!("{input_id}-suggestions") class="athlete-suggestions" role="status"><p>"Searching…"</p></div>
                    }.into_any(),
                    Suggestions::Ready(matches) => view! {
                        <div id=format!("{input_id}-suggestions") class="athlete-suggestions" role="listbox" aria-label="Athlete suggestions">
                            {matches.is_empty().then(|| view! { <p>"No matching athletes"</p> })}
                            {matches.iter().cloned().map(|name| {
                                let selected_name = name.clone();
                                view! {
                                    <button type="button" role="option" on:click=move |_| {
                                        schedule_search("");
                                        set_value.set(selected_name.clone());
                                    }>{name}</button>
                                }
                            }).collect_view()}
                        </div>
                    }.into_any(),
                })
            }}
        </div>
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debounce_is_a_short_typing_pause() {
        assert!(SUGGESTION_DEBOUNCE >= Duration::from_millis(150));
        assert!(SUGGESTION_DEBOUNCE <= Duration::from_millis(400));
    }

    #[test]
    fn suggestion_queries_need_three_trimmed_characters() {
        assert_eq!(suggestion_query(""), None);
        assert_eq!(suggestion_query("Te"), None);
        assert_eq!(suggestion_query("  Te  "), None);
        assert_eq!(suggestion_query("Tes"), Some("Tes".to_owned()));
        assert_eq!(suggestion_query("  Test  "), Some("Test".to_owned()));
        assert_eq!(suggestion_query("Zoë"), Some("Zoë".to_owned()));
    }

    #[test]
    fn only_the_newest_request_is_current() {
        let mut sequence = RequestSequence::default();
        let first = sequence.next();
        let second = sequence.next();

        assert_ne!(first, second);
        assert!(!sequence.is_current(first));
        assert!(sequence.is_current(second));

        // Clearing the input also starts a request, so earlier responses stay stale.
        let cleared = sequence.next();
        assert!(!sequence.is_current(second));
        assert!(sequence.is_current(cleared));
    }
}
