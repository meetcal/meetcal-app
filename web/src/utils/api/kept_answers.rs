use super::*;
use anyhow::Result;
use serde::Deserialize;
use serde_json::Value;
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    future::Future,
    rc::Rc,
    time::Duration,
};
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};
use wasm_bindgen_futures::JsFuture;

pub(super) const IF_NONE_MATCH_ARGUMENT: &str = "ifNoneMatch";
pub(super) const MAX_ANSWERS_KEPT_IN_MEMORY: usize = 16;
pub(super) const STORE_READ_WAIT: Duration = Duration::from_millis(300);
pub(super) const STORE_RETRY_AFTER_MS: f64 = 60.0 * 1000.0;

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

struct InMemory {
    kept: KeptAnswer,
    premium: bool,
    last_used: u64,
}

#[derive(Default)]
pub(super) struct KeptInMemory {
    answers: HashMap<String, InMemory>,
    uses: u64,
}

impl KeptInMemory {
    fn next_use(&mut self) -> u64 {
        self.uses += 1;
        self.uses
    }

    pub(super) fn get(&mut self, key: &str) -> Option<KeptAnswer> {
        let used = self.next_use();
        self.answers.get_mut(key).map(|answer| {
            answer.last_used = used;
            answer.kept.clone()
        })
    }

    pub(super) fn insert(&mut self, key: String, kept: KeptAnswer, premium: bool) {
        let last_used = self.next_use();
        self.answers.insert(
            key,
            InMemory {
                kept,
                premium,
                last_used,
            },
        );
        while self.answers.len() > MAX_ANSWERS_KEPT_IN_MEMORY {
            let Some(least_used) = self
                .answers
                .iter()
                .min_by_key(|(_, answer)| answer.last_used)
                .map(|(key, _)| key.clone())
            else {
                return;
            };
            self.answers.remove(&least_used);
        }
    }

    pub(super) fn forget_premium(&mut self) {
        self.answers.retain(|_, answer| !answer.premium);
    }
}

thread_local! {
    static KEPT_ANSWERS: RefCell<KeptInMemory> = RefCell::new(KeptInMemory::default());
    static STORE_TIMED_OUT_AT: Cell<Option<f64>> = const { Cell::new(None) };
}

pub(super) fn may_read_store(timed_out_at: Option<f64>, now: f64) -> bool {
    timed_out_at.is_none_or(|at| now - at >= STORE_RETRY_AFTER_MS)
}

pub(super) async fn first_or_none<W, T>(work: W, timer: T) -> Option<W::Output>
where
    W: Future,
    T: Future<Output = ()>,
{
    match futures::future::select(Box::pin(work), Box::pin(timer)).await {
        futures::future::Either::Left((done, _)) => Some(done),
        futures::future::Either::Right(_) => None,
    }
}

pub(super) async fn read_store(read: js_sys::Promise) -> Option<JsValue> {
    if !may_read_store(STORE_TIMED_OUT_AT.get(), js_sys::Date::now()) {
        return None;
    }
    match first_or_none(JsFuture::from(read), sleep(STORE_READ_WAIT)).await {
        Some(stored) => {
            STORE_TIMED_OUT_AT.set(None);
            stored
                .ok()
                .filter(|stored| !stored.is_null() && !stored.is_undefined())
        }
        None => {
            leptos::logging::warn!("The answer store did not answer in time; reading without it");
            STORE_TIMED_OUT_AT.set(Some(js_sys::Date::now()));
            None
        }
    }
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
    if let Some(kept) = KEPT_ANSWERS.with_borrow_mut(|kept| kept.get(key)) {
        return Some(kept);
    }
    let stored = read_store(stored_answer(key, js_sys::Date::now())).await?;
    let kept = KeptAnswer {
        etag: js_text(&stored, "etag")?,
        json: Rc::from(js_text(&stored, "json")?),
    };
    let premium = js_sys::Reflect::get(&stored, &JsValue::from_str("premium"))
        .ok()
        .and_then(|value| value.as_bool())
        .unwrap_or(true);
    KEPT_ANSWERS.with_borrow_mut(|answers| answers.insert(key.to_owned(), kept.clone(), premium));
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
    KEPT_ANSWERS.with_borrow_mut(|answers| answers.insert(key, kept, premium));
}

pub(crate) fn forget_premium_answers_kept() {
    KEPT_ANSWERS.with_borrow_mut(KeptInMemory::forget_premium);
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
