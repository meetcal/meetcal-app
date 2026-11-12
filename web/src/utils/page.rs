pub fn reload() {
    if let Some(window) = web_sys::window() {
        let _ = window.location().reload();
    }
}

#[cfg(not(target_arch = "wasm32"))]
const SECONDS_PER_GREGORIAN_YEAR: u64 = 31_556_952;

pub fn this_year() -> i32 {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::new_0().get_full_year() as i32
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let seconds = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_secs());
        1970 + i32::try_from(seconds / SECONDS_PER_GREGORIAN_YEAR).unwrap_or(0)
    }
}
