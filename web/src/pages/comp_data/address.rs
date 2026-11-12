use leptos::prelude::*;
use leptos_router::NavigateOptions;
use leptos_router::hooks::{use_location, use_navigate, use_query_map};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum HistoryEntry {
    Push,
    Replace,
}

fn percent_encoded(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(char::from(byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

pub(crate) fn address(path: &str, params: &[(&str, &str)]) -> String {
    let query = params
        .iter()
        .map(|(name, value)| (name, value.trim()))
        .filter(|(_, value)| !value.is_empty())
        .map(|(name, value)| format!("{name}={}", percent_encoded(value)))
        .collect::<Vec<_>>()
        .join("&");
    if query.is_empty() {
        path.to_owned()
    } else {
        format!("{path}?{query}")
    }
}

pub(crate) fn query_param(name: &'static str) -> Memo<String> {
    let query = use_query_map();
    Memo::new(move |_| {
        query
            .with(|params| params.get(name))
            .unwrap_or_default()
            .trim()
            .to_owned()
    })
}

#[derive(Clone, Copy)]
pub(crate) struct PageAddress {
    path: &'static str,
    go: Callback<(String, HistoryEntry)>,
}

impl PageAddress {
    pub(crate) fn show(&self, params: &[(&str, &str)], entry: HistoryEntry) {
        self.go.run((address(self.path, params), entry));
    }
}

fn browser_address() -> Option<String> {
    let location = web_sys::window()?.location();
    Some(format!(
        "{}{}",
        location.pathname().ok()?,
        location.search().ok()?
    ))
}

const ROUTER_SETTLE_MS: u64 = 300;

fn router_stopped_short_of(
    to: &str,
    browser_before: Option<&str>,
    browser_now: Option<&str>,
    router_now: &str,
) -> bool {
    browser_before.is_some()
        && browser_now == browser_before
        && browser_before != Some(to)
        && router_now == to
}

fn write_to_history(to: &str, entry: HistoryEntry) {
    let Some(history) = web_sys::window().and_then(|window| window.history().ok()) else {
        return;
    };
    let no_state = wasm_bindgen::JsValue::NULL;
    let _ = match entry {
        HistoryEntry::Push => history.push_state_with_url(&no_state, "", Some(to)),
        HistoryEntry::Replace => history.replace_state_with_url(&no_state, "", Some(to)),
    };
}

pub(crate) fn use_page_address(path: &'static str) -> PageAddress {
    let navigate = use_navigate();
    let location = use_location();
    PageAddress {
        path,
        go: Callback::new(move |(to, entry): (String, HistoryEntry)| {
            let browser_before = browser_address();
            navigate(
                &to,
                NavigateOptions {
                    replace: entry == HistoryEntry::Replace,
                    scroll: false,
                    ..NavigateOptions::default()
                },
            );
            set_timeout(
                move || {
                    let search = location.search.get_untracked();
                    let router_now = if search.is_empty() {
                        location.pathname.get_untracked()
                    } else {
                        format!(
                            "{}?{}",
                            location.pathname.get_untracked(),
                            search.trim_start_matches('?')
                        )
                    };
                    if router_stopped_short_of(
                        &to,
                        browser_before.as_deref(),
                        browser_address().as_deref(),
                        &router_now,
                    ) {
                        write_to_history(&to, entry);
                    }
                },
                std::time::Duration::from_millis(ROUTER_SETTLE_MS),
            );
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_address_carries_only_the_choices_that_are_set() {
        assert_eq!(address("/wrapped", &[]), "/wrapped");
        assert_eq!(
            address("/wrapped", &[("athlete", " "), ("year", "")]),
            "/wrapped"
        );
        assert_eq!(
            address("/wrapped", &[("athlete", " Ann Lee "), ("year", "2026")]),
            "/wrapped?athlete=Ann%20Lee&year=2026"
        );
        assert_eq!(
            address("/club-dashboard", &[("club", "Test Barbell"), ("meet", "")]),
            "/club-dashboard?club=Test%20Barbell"
        );
    }

    #[test]
    fn history_is_written_only_when_the_router_moved_and_the_browser_did_not() {
        let smith = "/wrapped?athlete=Smith";
        let lee = "/wrapped?athlete=Lee";
        assert!(router_stopped_short_of(smith, Some(lee), Some(lee), smith));
        let browser_followed = Some(smith);
        assert!(!router_stopped_short_of(
            smith,
            Some(lee),
            browser_followed,
            smith
        ));
        let visitor_went_back_meanwhile = lee;
        assert!(!router_stopped_short_of(
            smith,
            Some(lee),
            Some(lee),
            visitor_went_back_meanwhile
        ));
        assert!(!router_stopped_short_of(
            smith,
            Some(smith),
            Some(smith),
            smith
        ));
        assert!(!router_stopped_short_of(smith, None, None, smith));
    }

    #[test]
    fn names_with_marks_and_separators_survive_the_address() {
        assert_eq!(
            address("/meet-center", &[("meet", "A&B = Master's + José #1?")]),
            "/meet-center?meet=A%26B%20%3D%20Master%27s%20%2B%20Jos%C3%A9%20%231%3F"
        );
        assert_eq!(
            address(
                "/national-rankings",
                &[("division", "Women's Masters (40-44) 69kg")]
            ),
            "/national-rankings?division=Women%27s%20Masters%20%2840-44%29%2069kg"
        );
    }
}
