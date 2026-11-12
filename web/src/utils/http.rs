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

pub(crate) struct OnDrop<F: FnOnce()>(Option<F>);

impl<F: FnOnce()> OnDrop<F> {
    pub(crate) fn new(cleanup: F) -> Self {
        Self(Some(cleanup))
    }
}

impl<F: FnOnce()> Drop for OnDrop<F> {
    fn drop(&mut self) {
        if let Some(cleanup) = self.0.take() {
            cleanup();
        }
    }
}

fn described(error: JsValue) -> String {
    js_sys::Reflect::get(&error, &JsValue::from_str("message"))
        .ok()
        .and_then(|message| message.as_string())
        .or_else(|| error.as_string())
        .unwrap_or_else(|| format!("{error:?}"))
}

#[expect(
    clippy::disallowed_methods,
    reason = "the one place the site sends a request and times it out"
)]
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
    let _abandoned_or_settled = OnDrop::new({
        let abort = abort.clone();
        move || {
            if let Some(timer) = timer {
                timer.clear();
            }
            abort.abort();
        }
    });
    let failure = |error: JsValue| {
        if timed_out.get() {
            Failure::TimedOut
        } else {
            Failure::Unreachable(described(error))
        }
    };
    async {
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
    .await
}

#[cfg(test)]
mod tests {
    use super::OnDrop;
    use futures::FutureExt;
    use std::{cell::Cell, rc::Rc};

    #[test]
    fn a_request_dropped_while_in_flight_is_cancelled_once() {
        let cancelled = Rc::new(Cell::new(0));
        let request = {
            let cancelled = Rc::clone(&cancelled);
            async move {
                let _guard = OnDrop::new(move || cancelled.set(cancelled.get() + 1));
                futures::future::pending::<()>().await;
            }
        };
        assert_eq!(request.now_or_never(), None);
        assert_eq!(cancelled.get(), 1);
    }

    #[test]
    fn a_request_that_settles_cleans_up_once() {
        let cleaned = Rc::new(Cell::new(0));
        let request = {
            let cleaned = Rc::clone(&cleaned);
            async move {
                let _guard = OnDrop::new(move || cleaned.set(cleaned.get() + 1));
                7
            }
        };
        assert_eq!(request.now_or_never(), Some(7));
        assert_eq!(cleaned.get(), 1);
    }
}
