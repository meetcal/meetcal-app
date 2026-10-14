pub struct DataPageLink {
    pub path: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub seo_title: &'static str,
    pub access: Access,
}

/// Who can open a data page.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Access {
    /// Subscribers: the route sits behind `SubscriptionGate`, and its
    /// metadata keeps it out of search results.
    Subscription,
    /// Everyone, signed out included: the route has no gate, search engines
    /// may index it, and a shared link previews with `seo_description`.
    Free { seo_description: &'static str },
}

pub const DATA_PAGES: [DataPageLink; 12] = [
    DataPageLink {
        path: "/qualifying-totals",
        label: "Qualifying Totals",
        description: "Qualification totals by event, division, and weight class.",
        seo_title: "Weightlifting Qualifying Totals",
        access: Access::Subscription,
    },
    DataPageLink {
        path: "/standards",
        label: "Standards",
        description: "A and B standards by division and weight class.",
        seo_title: "Weightlifting Standards",
        access: Access::Subscription,
    },
    DataPageLink {
        path: "/results",
        label: "Results",
        description: "Search an athlete’s competition results from the last 20 years.",
        seo_title: "Athlete Competition Results",
        access: Access::Subscription,
    },
    DataPageLink {
        path: "/meet-center",
        label: "Meets",
        description: "Venue details, schedules, start lists, and complete meet results.",
        seo_title: "Weightlifting Meets, Schedules & Results",
        access: Access::Subscription,
    },
    DataPageLink {
        path: "/club-dashboard",
        label: "Club Dashboard",
        description: "Meet performance, medals, PRs, make rates, and athlete totals by club.",
        seo_title: "Weightlifting Club Meet Dashboard",
        access: Access::Subscription,
    },
    DataPageLink {
        path: "/wso-dashboard",
        label: "WSO Dashboard",
        description: "Participation, make rates, lifted volume, and results for a selected WSO.",
        seo_title: "USAW WSO Meet Dashboard",
        access: Access::Subscription,
    },
    DataPageLink {
        path: "/wrapped",
        label: "Athlete Wrapped",
        description: "Free yearly athlete recaps with best lifts, make rate, and progress.",
        seo_title: "Weightlifting Athlete Wrapped",
        access: Access::Free {
            seo_description: "Free Weightlifting Wrapped: an athlete's competition year in numbers, with meets, best lifts, make rate, and progress.",
        },
    },
    DataPageLink {
        path: "/rankings",
        label: "Rankings",
        description: "International rankings, totals, and percentage scores.",
        seo_title: "International Weightlifting Rankings",
        access: Access::Subscription,
    },
    DataPageLink {
        path: "/national-rankings",
        label: "National Rankings",
        description: "USAW and USAMW rankings by division, with optional year filtering.",
        seo_title: "National Weightlifting Rankings",
        access: Access::Subscription,
    },
    DataPageLink {
        path: "/records",
        label: "Records",
        description: "Snatch, clean and jerk, and total records.",
        seo_title: "Weightlifting Records",
        access: Access::Subscription,
    },
    DataPageLink {
        path: "/wso-records",
        label: "WSO Records",
        description: "State-organization records by division and weight class.",
        seo_title: "USAW WSO Records",
        access: Access::Subscription,
    },
    DataPageLink {
        path: "/adaptive-records",
        label: "Adaptive Records",
        description: "Top adaptive performances by gender and weight class.",
        seo_title: "Adaptive Weightlifting Records",
        access: Access::Subscription,
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_paths_and_labels_are_unique_and_well_formed() {
        let mut paths = DATA_PAGES.map(|page| page.path).to_vec();
        let mut labels = DATA_PAGES.map(|page| page.label).to_vec();
        assert!(paths.iter().all(|path| path.starts_with('/')));
        paths.sort_unstable();
        paths.dedup();
        labels.sort_unstable();
        labels.dedup();
        assert_eq!(paths.len(), DATA_PAGES.len());
        assert_eq!(labels.len(), DATA_PAGES.len());
    }

    #[test]
    fn every_catalog_page_has_a_route_gated_by_its_access() {
        let routes = include_str!("../../main.rs");
        for page in DATA_PAGES {
            let route = format!("path!(\"{}\")", page.path);
            let gated = format!("{route} view=|| view! {{ <SubscriptionGate>");
            assert!(
                routes.contains(&route),
                "{} is missing from the router in main.rs",
                page.path
            );
            assert_eq!(
                routes.contains(&gated),
                page.access == Access::Subscription,
                "{} is gated in main.rs unlike its access, {:?}",
                page.path,
                page.access
            );
        }
    }

    #[test]
    fn every_catalog_page_has_a_prerendered_seo_document() {
        let bootstrap = include_str!("../../../scripts/generate-bootstrap.sh");
        for page in DATA_PAGES {
            let stem = page.path.trim_start_matches('/');
            let escaped_title = page.seo_title.replace('&', "&amp;");
            let gated_entry = format!("{stem}|{}|{escaped_title}", page.path);
            match page.access {
                Access::Subscription => assert!(
                    bootstrap.contains(&gated_entry),
                    "generate-bootstrap.sh is missing or out of sync for: {gated_entry}"
                ),
                Access::Free { seo_description } => {
                    let entry = format!(
                        "render_page \"{stem}\" \"{}\" \\\n  \"{escaped_title}\" \\\n  \"{seo_description}\" \\\n  \"index, follow\"",
                        page.path
                    );
                    assert!(
                        bootstrap.contains(&entry),
                        "generate-bootstrap.sh is missing or out of sync for: {entry}"
                    );
                    assert!(
                        !bootstrap.contains(&gated_entry),
                        "{} is free but listed with the subscription pages",
                        page.path
                    );
                }
            }
        }
    }

    #[test]
    fn free_pages_are_in_the_sitemap_and_the_rest_are_not() {
        let sitemap = include_str!("../../../public/sitemap.xml");
        for page in DATA_PAGES {
            let entry = format!("<loc>https://www.meetcal.app{}</loc>", page.path);
            assert_eq!(
                sitemap.contains(&entry),
                matches!(page.access, Access::Free { .. }),
                "{} is listed in the sitemap unlike its access",
                page.path
            );
        }
    }
}
