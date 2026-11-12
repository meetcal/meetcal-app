mod catalog;
mod device_login;
mod meet_submissions;
mod pass;
mod schedule_builder;
#[cfg(test)]
mod tests;
mod transport;
#[cfg(test)]
pub(crate) mod wire;

pub(crate) use catalog::*;
pub(crate) use device_login::*;
pub(crate) use meet_submissions::*;
pub(crate) use pass::*;
pub(crate) use schedule_builder::*;
pub(crate) use transport::*;
#[cfg(test)]
pub(crate) use wire::wire_fixture;

use anyhow::Result;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;

fn read_response<T: DeserializeOwned>(query: Query, response: QueryResponse) -> Result<T> {
    read_body(query, answer_value(response)?)
}

pub(crate) fn read_body<T: DeserializeOwned>(query: Query, value: Value) -> Result<T> {
    match query.body {
        Body::Value => serde_json::from_value(whole_numbers_as_integers(value))
            .map_err(|error| user_error(query.function, UNREADABLE_MESSAGE, error)),
        Body::JsonText => {
            let text = value.get("json").and_then(Value::as_str).ok_or_else(|| {
                user_error(
                    query.function,
                    UNREADABLE_MESSAGE,
                    "answer has no json body",
                )
            })?;
            serde_json::from_str(text)
                .map_err(|error| user_error(query.function, UNREADABLE_MESSAGE, error))
        }
    }
}

pub(crate) async fn query_with<T, A>(query: Query, args: &A) -> Result<T>
where
    T: DeserializeOwned,
    A: Serialize + ?Sized,
{
    read_response(query, send(query, args).await?)
}

async fn send<A>(query: Query, args: &A) -> Result<QueryResponse>
where
    A: Serialize + ?Sized,
{
    let args = serde_json::to_value(args)
        .map_err(|error| user_error(query.function, UNREACHABLE_MESSAGE, error))?;
    if !carries_pass(query, &args) {
        return post(Endpoint::Query, query.function, &args, None).await;
    }
    send_with_pass(Endpoint::Query, query.function, &args, REQUEST_TIMEOUT).await
}

pub(crate) async fn premium_action<T, A>(action: Action, args: &A) -> Result<T>
where
    T: DeserializeOwned,
    A: Serialize + ?Sized,
{
    let function = action.function;
    let args = serde_json::to_value(args)
        .map_err(|error| user_error(function, UNREACHABLE_MESSAGE, error))?;
    let response = if SUBSCRIPTION_ACTIONS.contains(&function) {
        send_with_pass(Endpoint::Action, function, &args, action.timeout).await?
    } else {
        post_within(Endpoint::Action, function, &args, None, action.timeout).await?
    };
    read_action_body(function, answer_value(response)?)
}

pub(crate) fn read_action_body<T: DeserializeOwned>(function: &str, value: Value) -> Result<T> {
    serde_json::from_value(whole_numbers_as_integers(value))
        .map_err(|error| user_error(function, UNREADABLE_MESSAGE, error))
}

pub(crate) async fn query<T: DeserializeOwned>(query: Query) -> Result<T> {
    query_with(query, &NoArgs {}).await
}
