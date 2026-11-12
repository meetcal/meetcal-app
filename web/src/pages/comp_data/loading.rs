//! How a data page loads its answers: one skeleton, one error line with a
//! retry, one empty state.
//!
//! A page reads each answer through a [`Load`], which ties the answer to the
//! request it answers. A new choice (another meet, division, athlete) sends
//! its request at once, drops the one before it, and shows the loading state
//! until its own answer arrives: never the previous choice's answer, and never
//! a "nothing chosen" placeholder as if it were the answer.

use super::models::MeetQuery;
use super::ui::TableSkeleton;
use crate::utils::api::{Query, query_with};
use futures::future::{AbortHandle, abortable};
use leptos::prelude::*;
use leptos::task::spawn_local;
use std::fmt::Display;
use std::future::Future;

/// What a page shows for one answer.
#[derive(Debug, PartialEq)]
pub(crate) enum LoadState<'a, T> {
    /// The answer for the current request has not arrived.
    Loading,
    Failed(&'a str),
    Ready(&'a T),
}

/// One answer a page loads for the request `key` describes.
///
/// Each change of the key (or a retry) starts a request at once and aborts
/// the request before it, whose answer can then never be shown. Only the
/// answer whose key matches the current one is ever read, so a page never
/// shows an answer for a request it no longer makes. When the browser comes
/// back online, a failed load runs again by itself.
pub(crate) struct Load<K: Send + Sync + 'static, T: Send + Sync + 'static> {
    key: Memo<K>,
    answer: RwSignal<Option<(K, Result<T, String>)>>,
    attempts: RwSignal<u64>,
}

impl<K: Send + Sync + 'static, T: Send + Sync + 'static> Clone for Load<K, T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<K: Send + Sync + 'static, T: Send + Sync + 'static> Copy for Load<K, T> {}

impl<K, T> Load<K, T>
where
    K: Clone + PartialEq + Send + Sync + 'static,
    T: Send + Sync + 'static,
{
    /// Loads `fetch(key())`, again whenever `key()` changes.
    pub(crate) fn new<Fut>(
        key: impl Fn() -> K + Send + Sync + 'static,
        fetch: impl Fn(K) -> Fut + 'static,
    ) -> Self
    where
        Fut: Future<Output = Result<T, String>> + 'static,
    {
        let key = Memo::new(move |_| key());
        let answer = RwSignal::new(None::<(K, Result<T, String>)>);
        let attempts = RwSignal::new(0_u64);
        let in_flight = StoredValue::new_local(None::<AbortHandle>);

        Effect::new(move |_| {
            attempts.track();
            let request = key.get();
            if let Some(previous) = in_flight.try_update_value(Option::take).flatten() {
                previous.abort();
            }
            answer.set(None);

            let (future, handle) = abortable(untrack(|| fetch(request.clone())));
            in_flight.set_value(Some(handle));
            spawn_local(async move {
                // An aborted request was replaced; its answer is never shown.
                if let Ok(result) = future.await {
                    answer.try_set(Some((request, result)));
                }
            });
        });

        let load = Self {
            key,
            answer,
            attempts,
        };
        let reconnect = window_event_listener(leptos::ev::online, move |_| load.retry_failed());
        on_cleanup(move || {
            reconnect.remove();
            if let Some(request) = in_flight.try_update_value(Option::take).flatten() {
                request.abort();
            }
        });

        load
    }

    /// Reads the answer for the current request (reactively).
    pub(crate) fn with<R>(&self, read: impl FnOnce(LoadState<'_, T>) -> R) -> R {
        let key = self.key.get();
        self.answer
            .with(|answer| read(current_state(answer.as_ref(), &key)))
    }

    /// Sends the current request again.
    pub(crate) fn retry(&self) {
        self.attempts.try_update(|count| *count += 1);
    }

    /// Sends the current request again if its answer was an error.
    pub(crate) fn retry_failed(&self) {
        let failed = self
            .answer
            .try_with_untracked(|answer| matches!(answer, Some((_, Err(_)))))
            .unwrap_or(false);
        if failed {
            self.retry();
        }
    }
}

/// The state of `answer` for the request `key`: an answer to another
/// request, or none yet, is still loading.
fn current_state<'a, K: PartialEq, T>(
    answer: Option<&'a (K, Result<T, String>)>,
    key: &K,
) -> LoadState<'a, T> {
    match answer {
        Some((answered, result)) if answered == key => match result {
            Ok(value) => LoadState::Ready(value),
            Err(error) => LoadState::Failed(error),
        },
        _ => LoadState::Loading,
    }
}

/// The answer of `query`, which takes no arguments.
pub(crate) fn load_query<T>(query: Query) -> Load<(), T>
where
    T: serde::de::DeserializeOwned + Send + Sync + 'static,
{
    Load::new(
        || (),
        move |()| async move {
            crate::utils::api::query(query)
                .await
                .map_err(|error| error.to_string())
        },
    )
}

/// The rows of `query`, which takes no arguments, each as `shown` makes it.
pub(crate) fn load_rows<T>(query: Query, shown: fn(T) -> T) -> Load<(), Vec<T>>
where
    T: serde::de::DeserializeOwned + Send + Sync + 'static,
{
    Load::new(
        || (),
        move |()| async move {
            crate::utils::api::query::<Vec<T>>(query)
                .await
                .map(|rows| rows.into_iter().map(shown).collect())
                .map_err(|error| error.to_string())
        },
    )
}

/// One meet's rows from `query`, which takes `meet`; none when no meet is chosen.
pub(crate) async fn load_meet_data<T: serde::de::DeserializeOwned>(
    meet: String,
    query: Query,
) -> Result<Vec<T>, String> {
    if meet.is_empty() {
        return Ok(Vec::new());
    }
    query_with(query, &MeetQuery { meet })
        .await
        .map_err(|error| error.to_string())
}

/// Why `label` did not load, with a button that loads it again.
pub(crate) fn load_error(
    label: &str,
    error: impl Display,
    retry: impl Fn() + Send + Sync + 'static,
) -> AnyView {
    view! {
        <div class="data-status error" role="alert">
            <p>{format!("Could not load {label}: {error}")}</p>
            <button class="data-retry-button" type="button" on:click=move |_| retry()>
                "Try again"
            </button>
        </div>
    }
    .into_any()
}

/// A table's answer: a skeleton while it loads, the error, or `render`.
pub(crate) fn table_response<K, T>(
    load: Load<K, Vec<T>>,
    columns: usize,
    label: &'static str,
    render: impl FnOnce(&[T]) -> AnyView,
) -> AnyView
where
    K: Clone + PartialEq + Send + Sync + 'static,
    T: Send + Sync + 'static,
{
    load.with(|state| match state {
        LoadState::Loading => view! { <TableSkeleton columns /> }.into_any(),
        LoadState::Failed(error) => load_error(label, error, move || load.retry()),
        LoadState::Ready(rows) => render(rows),
    })
}

/// A picker's answer: `loading_message` while it loads, the error, or `render`.
pub(crate) fn select_response<K, T>(
    load: Load<K, Vec<T>>,
    loading_message: &'static str,
    label: &'static str,
    render: impl FnOnce(&[T]) -> AnyView,
) -> AnyView
where
    K: Clone + PartialEq + Send + Sync + 'static,
    T: Send + Sync + 'static,
{
    load.with(|state| match state {
        LoadState::Loading => view! { <p class="data-status">{loading_message}</p> }.into_any(),
        LoadState::Failed(error) => load_error(label, error, move || load.retry()),
        LoadState::Ready(rows) => render(rows),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_answer_to_the_current_request_is_shown() {
        let meet_a = ("Meet A".to_owned(), Ok(vec![1, 2]));
        assert_eq!(
            current_state(Some(&meet_a), &"Meet A".to_owned()),
            LoadState::Ready(&vec![1, 2])
        );
        // Meet B is chosen while meet A's answer is still the latest one.
        assert_eq!(
            current_state(Some(&meet_a), &"Meet B".to_owned()),
            LoadState::Loading
        );
        // The placeholder for "nothing chosen" is not an answer for a meet.
        let nothing: (String, Result<Vec<i32>, String>) = (String::new(), Ok(Vec::new()));
        assert_eq!(
            current_state(Some(&nothing), &"Meet A".to_owned()),
            LoadState::Loading
        );
        assert_eq!(
            current_state::<String, Vec<i32>>(None, &"Meet A".to_owned()),
            LoadState::Loading
        );
    }

    #[test]
    fn a_failed_answer_for_the_current_request_is_its_error() {
        let failed: (u8, Result<Vec<i32>, String>) = (1, Err("offline".to_owned()));
        assert_eq!(
            current_state(Some(&failed), &1),
            LoadState::Failed("offline")
        );
        assert_eq!(current_state(Some(&failed), &2), LoadState::Loading);
    }
}
