use std::cell::Cell;
use std::rc::Rc;
use std::time::Duration;
use wasm_bindgen::closure::Closure;
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

pub(crate) struct Upload<'a> {
    pub url: &'a str,
    pub body: &'a [u8],
    pub content_type: &'a str,
    pub silence_limit: Duration,
}

pub(crate) const STALL_CHECK_EVERY: Duration = Duration::from_secs(1);

pub(crate) fn stalled(last_progress_ms: f64, now_ms: f64, silence_limit: Duration) -> bool {
    now_ms - last_progress_ms >= silence_limit.as_secs_f64() * 1000.0
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

#[expect(
    clippy::disallowed_methods,
    reason = "the one place the site uploads a file, and cancels it once its progress stops"
)]
pub(crate) async fn upload(request: Upload<'_>) -> Result<Reply, Failure> {
    let unreachable = |error: JsValue| Failure::Unreachable(described(error));
    let xhr = web_sys::XmlHttpRequest::new().map_err(unreachable)?;
    let sending = xhr.upload().map_err(unreachable)?;
    xhr.open_with_async("POST", request.url, true)
        .map_err(unreachable)?;
    xhr.set_request_header("Content-Type", request.content_type)
        .map_err(unreachable)?;
    let last_progress = Rc::new(Cell::new(js_sys::Date::now()));
    let progressed = Closure::<dyn FnMut()>::new({
        let last_progress = Rc::clone(&last_progress);
        move || last_progress.set(js_sys::Date::now())
    });
    sending.set_onprogress(Some(progressed.as_ref().unchecked_ref()));
    xhr.set_onprogress(Some(progressed.as_ref().unchecked_ref()));
    let settled = js_sys::Promise::new(&mut |resolve, reject| {
        xhr.set_onload(Some(&resolve));
        xhr.set_onerror(Some(&reject));
        xhr.set_onabort(Some(&reject));
    });
    let timed_out = Rc::new(Cell::new(false));
    let watch = leptos::prelude::set_interval_with_handle(
        {
            let xhr = xhr.clone();
            let timed_out = Rc::clone(&timed_out);
            let last_progress = Rc::clone(&last_progress);
            let silence_limit = request.silence_limit;
            move || {
                if !timed_out.get()
                    && stalled(last_progress.get(), js_sys::Date::now(), silence_limit)
                {
                    timed_out.set(true);
                    let _ = xhr.abort();
                }
            }
        },
        STALL_CHECK_EVERY,
    )
    .ok();
    let _abandoned_or_settled = OnDrop::new({
        let xhr = xhr.clone();
        move || {
            if let Some(watch) = watch {
                watch.clear();
            }
            sending.set_onprogress(None);
            xhr.set_onprogress(None);
            let _ = xhr.abort();
        }
    });
    xhr.send_with_opt_u8_array(Some(request.body))
        .map_err(unreachable)?;
    let outcome = JsFuture::from(settled).await;
    drop(progressed);
    match outcome {
        Err(_) if timed_out.get() => Err(Failure::TimedOut),
        Err(_) => Err(Failure::Unreachable(
            "the upload could not reach the server".to_owned(),
        )),
        Ok(_) => Ok(Reply {
            status: xhr.status().map_err(unreachable)?,
            retry_after: xhr.get_response_header("Retry-After").ok().flatten(),
            body: xhr.response_text().ok().flatten().unwrap_or_default(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::OnDrop;
    use futures::FutureExt;
    use std::{cell::Cell, rc::Rc};

    #[test]
    fn an_upload_is_stalled_only_once_its_progress_has_stopped_for_the_whole_limit() {
        let limit = std::time::Duration::from_secs(120);
        assert!(!super::stalled(0.0, 119_999.0, limit));
        assert!(super::stalled(0.0, 120_000.0, limit));
        let progressed_at = 600_000.0;
        assert!(!super::stalled(
            progressed_at,
            progressed_at + 119_000.0,
            limit
        ));
    }

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
