use std::cell::Cell;
use std::rc::Rc;
use std::time::Duration;
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;

pub(crate) const OK: u16 = 200;
pub(crate) const TOO_MANY_REQUESTS: u16 = 429;
pub(crate) const SERVICE_UNAVAILABLE: u16 = 503;

#[derive(Debug)]
pub(crate) struct Reply {
    pub status: u16,
    pub retry_after: Option<String>,
    pub body: String,
}

#[derive(Debug)]
pub(crate) enum Failure {
    TimedOut,
    Unreachable(String),
}

pub(crate) struct Post<'a> {
    pub url: &'a str,
    pub body: JsValue,
    pub content_type: &'a str,
    pub bearer: Option<&'a str>,
    pub timeout: Duration,
}

fn described(error: JsValue) -> String {
    js_sys::Reflect::get(&error, &JsValue::from_str("message"))
        .ok()
        .and_then(|message| message.as_string())
        .or_else(|| error.as_string())
        .unwrap_or_else(|| format!("{error:?}"))
}

pub(crate) async fn post(request: Post<'_>) -> Result<Reply, Failure> {
    let window = web_sys::window().ok_or_else(|| Failure::Unreachable("no window".to_owned()))?;
    let abort =
        web_sys::AbortController::new().map_err(|error| Failure::Unreachable(described(error)))?;
    let timed_out = Rc::new(Cell::new(false));
    let timer = {
        let abort = abort.clone();
        let timed_out = Rc::clone(&timed_out);
        leptos::prelude::set_timeout_with_handle(
            move || {
                timed_out.set(true);
                abort.abort();
            },
            request.timeout,
        )
        .ok()
    };
    let failure = |error: JsValue| {
        if timed_out.get() {
            Failure::TimedOut
        } else {
            Failure::Unreachable(described(error))
        }
    };
    let outcome = async {
        let headers = web_sys::Headers::new().map_err(failure)?;
        headers
            .set("Content-Type", request.content_type)
            .map_err(failure)?;
        if let Some(token) = request.bearer {
            headers
                .set("Authorization", &format!("Bearer {token}"))
                .map_err(failure)?;
        }
        let init = web_sys::RequestInit::new();
        init.set_method("POST");
        init.set_headers(&headers);
        init.set_body(&request.body);
        init.set_signal(Some(&abort.signal()));
        let response: web_sys::Response =
            JsFuture::from(window.fetch_with_str_and_init(request.url, &init))
                .await
                .map_err(failure)?
                .dyn_into()
                .map_err(failure)?;
        let status = response.status();
        let retry_after = response.headers().get("Retry-After").ok().flatten();
        let body = JsFuture::from(response.text().map_err(failure)?)
            .await
            .map_err(failure)?
            .as_string()
            .unwrap_or_default();
        Ok(Reply {
            status,
            retry_after,
            body,
        })
    }
    .await;
    if let Some(timer) = timer {
        timer.clear();
    }
    outcome
}
