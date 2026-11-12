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
    serde_json::from_str(&text).ok()
}

pub(crate) fn write_local_work(meet: &str, work: &LocalWork) {
    let (Some(storage), Ok(text)) = (local_storage(), serde_json::to_string(work)) else {
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
