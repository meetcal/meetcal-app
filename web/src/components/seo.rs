use crate::pages::comp_data::catalog::DATA_PAGES;
use leptos::prelude::*;
use leptos_router::hooks::use_location;

const SITE_URL: &str = "https://meetcal.app";
const SOCIAL_IMAGE: &str = "https://meetcal.app/web-app-manifest-512x512.png";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PageMetadata {
    pub title: &'static str,
    pub description: &'static str,
    pub indexable: bool,
}

pub fn metadata_for_path(path: &str) -> PageMetadata {
    if let Some(page) = DATA_PAGES.iter().find(|page| page.path == path) {
        return competition_metadata(page.seo_title);
    }

    match path {
        "/" => PageMetadata {
            title: "MeetCal — Weightlifting Meet Schedules & Competition Data",
            description: "Explore Olympic weightlifting meet schedules, start lists, rankings, records, and competition tools with MeetCal.",
            indexable: true,
        },
        "/features" => PageMetadata {
            title: "MeetCal Features — Schedules, Start Lists & Rankings",
            description: "See how MeetCal helps athletes, coaches, and fans navigate weightlifting schedules, start lists, rankings, reminders, and meet-day details.",
            indexable: true,
        },
        "/privacy" => PageMetadata {
            title: "Privacy Policy — MeetCal",
            description: "Learn how MeetCal collects, uses, shares, and protects information across its apps, website, and related services.",
            indexable: true,
        },
        "/terms" => PageMetadata {
            title: "Terms of Use — MeetCal",
            description: "Read the terms that apply when using the MeetCal apps, website, competition data, and related services.",
            indexable: true,
        },
        "/subscription" => PageMetadata {
            title: "Manage Your MeetCal Subscription in the App",
            description: "Open MeetCal on iOS or Android to start, change, restore, or cancel your subscription.",
            indexable: false,
        },
        "/comp-data" => competition_metadata("Competition Data"),
        _ => PageMetadata {
            title: "Page Not Found — MeetCal",
            description: "The requested MeetCal page could not be found.",
            indexable: false,
        },
    }
}

fn competition_metadata(name: &'static str) -> PageMetadata {
    PageMetadata {
        title: name,
        description: "Sign in with your MeetCal account to explore subscription competition data on the web.",
        indexable: false,
    }
}

#[component]
pub fn RouteMetadata() -> impl IntoView {
    let location = use_location();

    Effect::new(move |_| {
        let path = location.pathname.get();
        let metadata = metadata_for_path(&path);
        let Some(document) = web_sys::window().and_then(|window| window.document()) else {
            return;
        };

        document.set_title(metadata.title);
        set_content(&document, "meta-description", metadata.description);
        set_content(
            &document,
            "meta-robots",
            if metadata.indexable {
                "index, follow"
            } else {
                "noindex, nofollow"
            },
        );
        set_content(&document, "meta-og-title", metadata.title);
        set_content(&document, "meta-og-description", metadata.description);
        set_content(&document, "meta-twitter-title", metadata.title);
        set_content(&document, "meta-twitter-description", metadata.description);
        set_content(&document, "meta-og-image", SOCIAL_IMAGE);
        set_content(&document, "meta-twitter-image", SOCIAL_IMAGE);

        let canonical = format!("{SITE_URL}{path}");
        set_attribute(&document, "canonical-url", "href", &canonical);
        set_content(&document, "meta-og-url", &canonical);
    });

    view! { <></> }
}

fn set_content(document: &web_sys::Document, id: &str, value: &str) {
    set_attribute(document, id, "content", value);
}

fn set_attribute(document: &web_sys::Document, id: &str, attribute: &str, value: &str) {
    if let Some(element) = document.get_element_by_id(id) {
        let _ = element.set_attribute(attribute, value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_pages_are_indexable_with_distinct_titles() {
        let public = ["/", "/features", "/privacy", "/terms"];
        let mut titles = public
            .into_iter()
            .map(metadata_for_path)
            .inspect(|metadata| assert!(metadata.indexable))
            .map(|metadata| metadata.title)
            .collect::<Vec<_>>();
        titles.sort_unstable();
        titles.dedup();
        assert_eq!(titles.len(), public.len());
    }

    #[test]
    fn gated_and_unknown_pages_are_not_indexable() {
        for path in [
            "/comp-data",
            "/qualifying-totals",
            "/subscription",
            "/missing",
        ] {
            assert!(
                !metadata_for_path(path).indexable,
                "{path} should not be indexed"
            );
        }
    }
}
