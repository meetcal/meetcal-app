use super::models::LocalWork;
use crate::utils::api::ExportFile;
use wasm_bindgen::JsCast;

const DOWNLOAD_URL_LIFETIME: std::time::Duration = std::time::Duration::from_secs(60);

const LOCAL_WORK_PREFIX: &str = "meetcal.scheduleBuilder:";

pub(crate) fn local_work_key(meet: &str) -> String {
    format!("{LOCAL_WORK_PREFIX}{meet}")
}

fn local_storage() -> Option<web_sys::Storage> {
    web_sys::window()?.local_storage().ok().flatten()
}

pub(crate) fn read_local_work(meet: &str) -> Option<LocalWork> {
    let text = local_storage()?.get_item(&local_work_key(meet)).ok()??;
    local_work_of(&text)
}

pub(crate) fn local_work_of(text: &str) -> Option<LocalWork> {
    let value = serde_json::from_str::<serde_json::Value>(text).ok()?;
    serde_json::from_value(value).ok()
}

pub(crate) fn local_work_text(work: &LocalWork) -> Option<String> {
    serde_json::to_value(work)
        .ok()
        .map(|value| value.to_string())
}

pub(crate) fn write_local_work(meet: &str, work: &LocalWork) {
    let (Some(storage), Some(text)) = (local_storage(), local_work_text(work)) else {
        return;
    };
    if storage.set_item(&local_work_key(meet), &text).is_err() {
        leptos::logging::warn!("The schedule could not be kept in this browser");
    }
}

pub(crate) fn remove_local_work(meet: &str) {
    if let Some(storage) = local_storage() {
        let _ = storage.remove_item(&local_work_key(meet));
    }
}

pub(crate) fn focus_element(id: &str) -> bool {
    let Some(element) = web_sys::window()
        .and_then(|window| window.document())
        .and_then(|document| document.get_element_by_id(id))
    else {
        return false;
    };
    if element.closest("[inert]").ok().flatten().is_some() {
        return false;
    }
    element
        .dyn_into::<web_sys::HtmlElement>()
        .is_ok_and(|element| element.focus().is_ok())
}

pub(crate) fn now_ms() -> f64 {
    js_sys::Date::now()
}

pub(crate) fn save_download(file: &ExportFile) -> Result<(), String> {
    let bytes = file.bytes().map_err(|error| error.to_string())?;
    let failed = || "Your browser couldn’t save the file.".to_owned();
    let window = web_sys::window().ok_or_else(failed)?;
    let document = window.document().ok_or_else(failed)?;
    let parts = js_sys::Array::of1(&js_sys::Uint8Array::from(bytes.as_slice()));
    let properties = web_sys::BlobPropertyBag::new();
    properties.set_type(&file.content_type);
    let blob = web_sys::Blob::new_with_u8_array_sequence_and_options(&parts, &properties)
        .map_err(|_| failed())?;
    let url = web_sys::Url::create_object_url_with_blob(&blob).map_err(|_| failed())?;
    let anchor = document
        .create_element("a")
        .ok()
        .and_then(|element| element.dyn_into::<web_sys::HtmlAnchorElement>().ok())
        .ok_or_else(failed)?;
    anchor.set_href(&url);
    anchor.set_download(&file.file_name);
    anchor.set_hidden(true);
    let body = document.body().ok_or_else(failed)?;
    let _ = body.append_child(&anchor);
    anchor.click();
    anchor.remove();
    leptos::prelude::set_timeout(
        move || {
            let _ = web_sys::Url::revoke_object_url(&url);
        },
        DOWNLOAD_URL_LIFETIME,
    );
    Ok(())
}

pub(crate) fn print_page() {
    if let Some(window) = web_sys::window()
        && window.print().is_err()
    {
        leptos::logging::warn!("The browser refused to print");
    }
}

pub(crate) fn local_date(ms: f64) -> String {
    js_sys::Date::new(&wasm_bindgen::JsValue::from_f64(ms))
        .to_locale_date_string("en-US", &wasm_bindgen::JsValue::UNDEFINED)
        .as_string()
        .unwrap_or_default()
}

pub(crate) fn local_date_time(ms: f64) -> String {
    let style = js_sys::Object::new();
    for (field, value) in [("dateStyle", "medium"), ("timeStyle", "short")] {
        let _ = js_sys::Reflect::set(&style, &field.into(), &value.into());
    }
    js_sys::Date::new(&wasm_bindgen::JsValue::from_f64(ms))
        .to_locale_string("en-US", &style)
        .as_string()
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::api::{
        Basis, BuilderDay, BuilderEdit, BuilderOptions, Grouping, ScheduleBase, SessionOrder,
    };

    #[test]
    fn work_kept_in_the_browser_reads_back_as_it_was_written() {
        let work = LocalWork {
            options: BuilderOptions {
                days: vec![BuilderDay {
                    date: "2026-11-21".to_owned(),
                    first_start: "08:30".to_owned(),
                }],
                session_minutes: 120,
                break_minutes: 0,
                max_athletes_per_platform: 15,
                max_sessions_per_day: None,
                platforms: vec!["Red".to_owned(), "Blue".to_owned()],
                grouping: Grouping::WeightClass,
                separate_age_groups: true,
                order: SessionOrder::WomenThenMen,
            },
            edits: vec![
                BuilderEdit::AddAthlete {
                    athlete: "9|ella late".to_owned(),
                    to_session: 1,
                    to_platform: "Red".to_owned(),
                },
                BuilderEdit::RemoveAthlete {
                    athlete: "8|victor shaver".to_owned(),
                    from_session: 2,
                    from_platform: "Red".to_owned(),
                    occurrence: 0,
                },
            ],
            basis: Basis {
                base: ScheduleBase::Published,
                base_version: Some("p2".to_owned()),
            },
            saved_at: 1_794_539_803_443.0,
        };
        let text = local_work_text(&work).unwrap();
        assert_eq!(local_work_of(&text), Some(work));
        assert_eq!(local_work_of("not json"), None);
    }
}
