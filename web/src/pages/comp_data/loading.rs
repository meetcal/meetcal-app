use super::models::MeetQuery;
use super::ui::TableSkeleton;
use leptos::prelude::*;
use std::fmt::Display;

pub(crate) async fn load_meet_data<T: serde::de::DeserializeOwned>(
    meet: String,
    path: &str,
) -> Result<Vec<T>, String> {
    if meet.is_empty() {
        return Ok(Vec::new());
    }
    crate::utils::api::get_api_response_with_query(path, &MeetQuery { meet })
        .await
        .map_err(|error| error.to_string())
}

pub(crate) fn load_error(label: &str, error: impl Display) -> AnyView {
    view! { <p class="data-status error">{format!("Could not load {label}: {error}")}</p> }
        .into_any()
}

pub(crate) fn table_response<T, E: Display>(
    response: &Option<Result<Vec<T>, E>>,
    columns: usize,
    label: &'static str,
    render: impl FnOnce(&[T]) -> AnyView,
) -> AnyView {
    match response {
        None => view! { <TableSkeleton columns /> }.into_any(),
        Some(Err(error)) => load_error(label, error),
        Some(Ok(rows)) => render(rows),
    }
}

pub(crate) fn select_response<T, E: Display>(
    response: &Option<Result<Vec<T>, E>>,
    loading_message: &'static str,
    label: &'static str,
    render: impl FnOnce(&[T]) -> AnyView,
) -> AnyView {
    match response {
        None => view! { <p class="data-status">{loading_message}</p> }.into_any(),
        Some(Err(error)) => load_error(label, error),
        Some(Ok(rows)) => render(rows),
    }
}
