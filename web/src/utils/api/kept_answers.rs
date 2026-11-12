use super::*;
use anyhow::Result;
use serde::Deserialize;
use serde_json::Value;
use std::{cell::RefCell, collections::HashMap, rc::Rc};
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};
use wasm_bindgen_futures::JsFuture;

pub(super) const IF_NONE_MATCH_ARGUMENT: &str = "ifNoneMatch";

#[derive(Deserialize)]
pub(super) struct TextAnswer {
    #[serde(default)]
    pub(super) etag: Option<String>,
    #[serde(default)]
    pub(super) json: Option<String>,
}

#[derive(Clone)]
pub(super) struct KeptAnswer {
    pub(super) etag: String,
    pub(super) json: Rc<str>,
}

thread_local! {
    static KEPT_ANSWERS: RefCell<HashMap<String, (KeptAnswer, bool)>> = RefCell::new(HashMap::new());
}

#[wasm_bindgen(module = "/src/answer_store.js")]
extern "C" {
    fn stored_answer(key: &str, now: f64) -> js_sys::Promise;
    fn store_answer(
        key: &str,
        etag: &str,
        json: &str,
        premium: bool,
        expires_at: f64,
        now: f64,
    ) -> js_sys::Promise;
    pub(super) fn stored_pass(user: &str, now: f64) -> js_sys::Promise;
    pub(super) fn store_pass(user: &str, pass: &str, until: f64) -> js_sys::Promise;
    fn forget_premium_answers() -> js_sys::Promise;
}

pub(crate) fn answer_key(function: &str, args: &Value) -> String {
    let mut fields = args
        .as_object()
        .map(|fields| {
            fields
                .iter()
                .filter(|(name, value)| {
                    !value.is_null()
                        && name.as_str() != PASS_ARGUMENT
                        && name.as_str() != IF_NONE_MATCH_ARGUMENT
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    fields.sort_by(|left, right| left.0.cmp(right.0));
    let fields = fields
        .into_iter()
        .map(|(name, value)| Value::Array(vec![Value::from(name.as_str()), value.clone()]))
        .collect::<Value>();
    format!("{function}:{fields}")
}

pub(super) fn js_text(value: &JsValue, name: &str) -> Option<String> {
    js_sys::Reflect::get(value, &JsValue::from_str(name))
        .ok()
        .and_then(|field| field.as_string())
}

pub(super) async fn recalled_answer(key: &str) -> Option<KeptAnswer> {
    if let Some((kept, _)) = KEPT_ANSWERS.with_borrow(|kept| kept.get(key).cloned()) {
        return Some(kept);
    }
    let stored = JsFuture::from(stored_answer(key, js_sys::Date::now()))
        .await
        .ok()?;
    let kept = KeptAnswer {
        etag: js_text(&stored, "etag")?,
        json: Rc::from(js_text(&stored, "json")?),
    };
    let premium = js_sys::Reflect::get(&stored, &JsValue::from_str("premium"))
        .ok()
        .and_then(|value| value.as_bool())
        .unwrap_or(true);
    KEPT_ANSWERS.with_borrow_mut(|answers| answers.insert(key.to_owned(), (kept.clone(), premium)));
    Some(kept)
}

pub(super) fn keep_answer(key: String, kept: KeptAnswer, premium: bool) {
    let now = js_sys::Date::now();
    let expires_at = if premium {
        let Some(until) = held_pass_until().filter(|until| *until > now) else {
            return;
        };
        until
    } else {
        f64::INFINITY
    };
    let _ = store_answer(&key, &kept.etag, &kept.json, premium, expires_at, now);
    KEPT_ANSWERS.with_borrow_mut(|answers| answers.insert(key, (kept, premium)));
}

pub(crate) fn forget_premium_answers_kept() {
    KEPT_ANSWERS.with_borrow_mut(|answers| answers.retain(|_, (_, premium)| !*premium));
    let _ = forget_premium_answers();
}

pub(super) fn with_argument(args: &Value, name: &str, value: &str) -> Value {
    let mut args = args.clone();
    if let Some(fields) = args.as_object_mut() {
        fields.insert(name.to_owned(), Value::from(value));
    }
    args
}

pub(super) fn text_of(
    query: Query,
    answer: TextAnswer,
    kept: Option<KeptAnswer>,
) -> Result<(Rc<str>, Option<KeptAnswer>)> {
    let TextAnswer { etag, json } = answer;
    if let Some(json) = json {
        let json: Rc<str> = Rc::from(json);
        let fresh = etag.filter(|_| query.revalidates).map(|etag| KeptAnswer {
            etag,
            json: Rc::clone(&json),
        });
        return Ok((json, fresh));
    }
    match (etag, kept) {
        (Some(etag), Some(kept)) if kept.etag == etag => Ok((kept.json, None)),
        (Some(_) | None, Some(_) | None) => Err(user_error(
            query.function,
            UNREADABLE_MESSAGE,
            "answer has no json body",
        )),
    }
}
