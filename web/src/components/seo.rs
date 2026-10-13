use crate::pages::comp_data::catalog::DATA_PAGES;
use leptos::prelude::*;
use leptos_router::hooks::use_location;

/// The site's one public host. The apex, meetcal.app, redirects here, so every
/// canonical URL, og:url and sitemap entry names www (#206).
const SITE_URL: &str = "https://www.meetcal.app";
const SOCIAL_IMAGE: &str = "https://www.meetcal.app/web-app-manifest-512x512.png";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PageMetadata {
    pub title: &'static str,
    pub description: &'static str,
    pub indexable: bool,
    /// False for a path the router does not know (the Not Found page), which
    /// has no canonical URL.
    pub canonical: bool,
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
            canonical: true,
        },
        "/features" => PageMetadata {
            title: "MeetCal Features — Schedules, Start Lists & Rankings",
            description: "See how MeetCal helps athletes, coaches, and fans navigate weightlifting schedules, start lists, rankings, reminders, and meet-day details.",
            indexable: true,
            canonical: true,
        },
        "/privacy" => PageMetadata {
            title: "Privacy Policy — MeetCal",
            description: "Learn how MeetCal collects, uses, shares, and protects information across its apps, website, and related services.",
            indexable: true,
            canonical: true,
        },
        "/terms" => PageMetadata {
            title: "Terms of Use — MeetCal",
            description: "Read the terms that apply when using the MeetCal apps, website, competition data, and related services.",
            indexable: true,
            canonical: true,
        },
        "/subscription" => PageMetadata {
            title: "Manage Your MeetCal Subscription in the App",
            description: "Open MeetCal on iOS or Android to start, change, restore, or cancel your subscription.",
            indexable: false,
            canonical: true,
        },
        "/comp-data" => competition_metadata("Competition Data"),
        _ => PageMetadata {
            title: "Page Not Found — MeetCal",
            description: "The requested MeetCal page could not be found.",
            indexable: false,
            canonical: false,
        },
    }
}

fn competition_metadata(name: &'static str) -> PageMetadata {
    PageMetadata {
        title: name,
        description: "Sign in with your MeetCal account to explore subscription competition data on the web.",
        indexable: false,
        canonical: true,
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
        // The 404 shell has no canonical link and the router keeps the
        // document across navigations, so create the link on a known route
        // and remove it on an unknown one, whichever way the visitor goes.
        set_canonical_link(&document, metadata.canonical.then_some(canonical.as_str()));
        set_content(&document, "meta-og-url", &canonical);
    });

    view! { <></> }
}

const CANONICAL_ID: &str = "canonical-url";

fn set_canonical_link(document: &web_sys::Document, href: Option<&str>) {
    let existing = document.get_element_by_id(CANONICAL_ID);
    let Some(href) = href else {
        if let Some(link) = existing {
            link.remove();
        }
        return;
    };
    let link = match existing {
        Some(link) => link,
        None => {
            let Ok(link) = document.create_element("link") else {
                return;
            };
            let Ok(Some(head)) = document.query_selector("head") else {
                return;
            };
            link.set_id(CANONICAL_ID);
            let _ = link.set_attribute("rel", "canonical");
            if head.append_child(&link).is_err() {
                return;
            }
            link
        }
    };
    let _ = link.set_attribute("href", href);
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

    #[test]
    fn only_unknown_pages_lack_a_canonical_url() {
        for path in [
            "/",
            "/features",
            "/comp-data",
            "/qualifying-totals",
            "/subscription",
        ] {
            assert!(
                metadata_for_path(path).canonical,
                "{path} should have a canonical URL"
            );
        }
        assert!(!metadata_for_path("/missing").canonical);
    }

    #[test]
    fn static_urls_name_the_canonical_host() {
        assert_eq!(SITE_URL, "https://www.meetcal.app");
        assert!(SOCIAL_IMAGE.starts_with(SITE_URL));
        for (name, text) in [
            ("index.html", include_str!("../../index.html")),
            (
                "generate-bootstrap.sh",
                include_str!("../../scripts/generate-bootstrap.sh"),
            ),
            ("sitemap.xml", include_str!("../../public/sitemap.xml")),
            ("robots.txt", include_str!("../../public/robots.txt")),
        ] {
            assert!(
                !text.contains("https://meetcal.app"),
                "{name} names the apex host, which redirects to {SITE_URL}"
            );
            assert!(text.contains(SITE_URL), "{name} should name {SITE_URL}");
        }
    }
}
