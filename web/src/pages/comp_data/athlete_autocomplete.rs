use super::combobox::{Combobox, SuggestionCopy, Suggestions};
use super::models::{AthleteSearchQuery, AthleteSearchResponse};
use crate::utils::api::{queries, query_with};
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
                let response = query_with::<AthleteSearchResponse, _>(
                    queries::SEARCH,
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

    // Stops the pending search and discards the one in flight, keeping
    // suggestions already shown, so Down can bring them back.
    let stop_search = move || {
        cancel_pending_search();
        if sequence.try_update_value(RequestSequence::next).is_some()
            && suggestions.get_untracked() == Suggestions::Searching
        {
            set_suggestions.set(Suggestions::Idle);
        }
    };

    view! {
        <Combobox
            input_id=input_id
            label="Athlete"
            placeholder="Athlete name"
            input_class="data-filter"
            wrapper_class=format!("athlete-autocomplete {wrapper_class}")
            list_class="athlete-suggestions"
            required=true
            value=value
            suggestions=suggestions
            copy=SuggestionCopy {
                list_label: "Athlete suggestions",
                no_matches: "No matching athletes",
                failed: "Couldn’t load athlete suggestions. Keep typing, or search by full name.",
            }
            on_input=move |next: String| {
                schedule_search(&next);
                set_value.set(next);
            }
            on_select=move |name: String| {
                schedule_search("");
                set_value.set(name);
            }
            // Submitting, Escape, or leaving the field: stop the pending
            // search, so its answer can't reopen the list over the results.
            on_dismiss=move |()| stop_search()
        />
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
