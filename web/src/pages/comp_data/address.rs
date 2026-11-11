use leptos::prelude::*;
use leptos_router::NavigateOptions;
use leptos_router::hooks::{use_navigate, use_query_map};

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

pub(crate) fn use_page_address(path: &'static str) -> PageAddress {
    let navigate = use_navigate();
    PageAddress {
        path,
        go: Callback::new(move |(to, entry): (String, HistoryEntry)| {
            navigate(
                &to,
                NavigateOptions {
                    replace: entry == HistoryEntry::Replace,
                    scroll: false,
                    ..NavigateOptions::default()
                },
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
