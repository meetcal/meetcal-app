use super::{Body, Query, QueryResponse, read_body};
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json, value::RawValue};

macro_rules! wire_fixture {
    ($name:literal) => {
        include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../fixtures/wire/",
            $name,
            ".json"
        ))
    };
}

pub(crate) use wire_fixture;

#[derive(Deserialize)]
struct Fixture {
    function: String,
    encoding: String,
    answers: Vec<Answer>,
}

#[derive(Deserialize)]
struct Answer {
    body: Value,
}

fn as_convex_sends(value: Value) -> Value {
    match value {
        Value::Number(number) => number
            .as_f64()
            .filter(|_| !number.is_f64())
            .map_or(Value::Number(number), Value::from),
        Value::Array(items) => items.into_iter().map(as_convex_sends).collect(),
        Value::Object(fields) => fields
            .into_iter()
            .map(|(key, field)| (key, as_convex_sends(field)))
            .collect(),
        other @ (Value::Null | Value::Bool(_) | Value::String(_)) => other,
    }
}

pub(crate) fn answers(function: &str, body: Body, fixture: &str) -> Vec<Value> {
    let fixture: Fixture = serde_json::from_str(fixture).unwrap();
    assert_eq!(fixture.function, function);
    let encoding = match body {
        Body::Value => "value",
        Body::JsonText => "jsonText",
    };
    assert_eq!(fixture.encoding, encoding, "{function}");
    fixture
        .answers
        .into_iter()
        .map(|answer| match body {
            Body::Value => as_convex_sends(answer.body),
            Body::JsonText => json!({
                "etag": "\"wire-fixture\"",
                "json": answer.body.to_string(),
            }),
        })
        .collect()
}

fn raw(value: &Value) -> Box<RawValue> {
    RawValue::from_string(value.to_string()).unwrap()
}

pub(crate) fn read<T: DeserializeOwned>(query: Query, fixture: &str) -> Vec<T> {
    answers(query.function, query.body, fixture)
        .into_iter()
        .map(|value| read_body(query, &raw(&value)).unwrap())
        .collect()
}

pub(super) fn responses(function: &str, fixture: &str) -> Vec<QueryResponse> {
    answers(function, Body::Value, fixture)
        .into_iter()
        .map(|value| QueryResponse::Success { value: raw(&value) })
        .collect()
}
