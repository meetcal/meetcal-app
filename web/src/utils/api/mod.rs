mod catalog;
mod device_login;
mod kept_answers;
mod meet_submissions;
mod pass;
#[cfg(test)]
mod tests;
mod transport;
#[cfg(test)]
pub(crate) mod wire;

pub(crate) use catalog::*;
pub(crate) use device_login::*;
pub(crate) use kept_answers::*;
pub(crate) use meet_submissions::*;
pub(crate) use pass::*;
pub(crate) use transport::*;
#[cfg(test)]
pub(crate) use wire::wire_fixture;

use anyhow::Result;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, value::RawValue};

fn read_response<T: DeserializeOwned>(query: Query, response: QueryResponse) -> Result<T> {
    read_body(query, &answer_value(response)?)
}

pub(crate) fn read_body<T: DeserializeOwned>(query: Query, value: &RawValue) -> Result<T> {
    match query.body {
        Body::Value => read_text(query, value.get()),
        Body::JsonText => {
            let text = serde_json::from_str::<TextAnswer>(value.get())
                .ok()
                .and_then(|answer| answer.json)
                .ok_or_else(|| {
                    user_error(
                        query.function,
                        UNREADABLE_MESSAGE,
                        "answer has no json body",
                    )
                })?;
            read_text(query, &text)
        }
    }
}

fn read_text<T: DeserializeOwned>(query: Query, text: &str) -> Result<T> {
    let read = match query.body {
        Body::Value => serde_json::from_str::<serde_json::Value>(text)
            .and_then(|value| serde_json::from_value(whole_numbers_as_integers(value))),
        Body::JsonText => serde_json::from_str(text),
    };
    read.map_err(|error| user_error(query.function, UNREADABLE_MESSAGE, error))
}

pub(crate) async fn query_with<T, A>(query: Query, args: &A) -> Result<T>
where
    T: DeserializeOwned,
    A: Serialize + ?Sized,
{
    let args = serde_json::to_value(args)
        .map_err(|error| user_error(query.function, UNREACHABLE_MESSAGE, error))?;
    let premium = carries_pass(query, &args);
    let key = query.revalidates.then(|| answer_key(query.function, &args));
    let kept = match &key {
        Some(key) => recalled_answer(key).await,
        None => None,
    };
    let sent = match &kept {
        Some(kept) => with_argument(&args, IF_NONE_MATCH_ARGUMENT, &kept.etag),
        None => args,
    };
    let response = if premium {
        send_with_pass(Endpoint::Query, query.function, &sent, REQUEST_TIMEOUT).await?
    } else {
        post(Endpoint::Query, query.function, &sent, None).await?
    };
    if !query.revalidates {
        return read_response(query, response);
    }
    let value = answer_value(response)?;
    let answer = serde_json::from_str::<TextAnswer>(value.get())
        .map_err(|error| user_error(query.function, UNREADABLE_MESSAGE, error))?;
    drop(value);
    let (text, fresh) = text_of(query, answer, kept)?;
    let read = read_text(query, &text);
    if let (Ok(_), Some(key), Some(fresh)) = (&read, key, fresh) {
        keep_answer(key, fresh, premium);
    }
    read
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
    read_action_body(function, answer_json(response)?)
}

pub(crate) fn read_action_body<T: DeserializeOwned>(function: &str, value: Value) -> Result<T> {
    serde_json::from_value(whole_numbers_as_integers(value))
        .map_err(|error| user_error(function, UNREADABLE_MESSAGE, error))
}

pub(crate) async fn query<T: DeserializeOwned>(query: Query) -> Result<T> {
    query_with(query, &NoArgs {}).await
}
