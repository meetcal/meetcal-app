pub struct DataPageLink {
    pub path: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub seo_title: &'static str,
}

pub const DATA_PAGES: [DataPageLink; 12] = [
    DataPageLink {
        path: "/qualifying-totals",
        label: "Qualifying Totals",
        description: "Qualification totals by event, division, and weight class.",
        seo_title: "Weightlifting Qualifying Totals",
    },
    DataPageLink {
        path: "/standards",
        label: "Standards",
        description: "A and B standards by division and weight class.",
        seo_title: "Weightlifting Standards",
    },
    DataPageLink {
        path: "/results",
        label: "Results",
        description: "Search an athlete’s competition results over a date range.",
        seo_title: "Athlete Competition Results",
    },
    DataPageLink {
        path: "/meet-center",
        label: "Meets",
        description: "Venue details, schedules, start lists, and complete meet results.",
        seo_title: "Weightlifting Meets, Schedules & Results",
    },
    DataPageLink {
        path: "/club-dashboard",
        label: "Club Dashboard",
        description: "Meet performance, medals, PRs, make rates, and athlete totals by club.",
        seo_title: "Weightlifting Club Meet Dashboard",
    },
    DataPageLink {
        path: "/wso-dashboard",
        label: "WSO Dashboard",
        description: "Participation, make rates, lifted volume, and results for a selected WSO.",
        seo_title: "USAW WSO Meet Dashboard",
    },
    DataPageLink {
        path: "/wrapped",
        label: "Athlete Wrapped",
        description: "Yearly athlete recaps with best lifts, make rate, and progress.",
        seo_title: "Weightlifting Athlete Wrapped",
    },
    DataPageLink {
        path: "/rankings",
        label: "Rankings",
        description: "International rankings, totals, and percentage scores.",
        seo_title: "International Weightlifting Rankings",
    },
    DataPageLink {
        path: "/national-rankings",
        label: "National Rankings",
        description: "USAW and USAMW rankings by division, with optional year filtering.",
        seo_title: "National Weightlifting Rankings",
    },
    DataPageLink {
        path: "/records",
        label: "Records",
        description: "Snatch, clean and jerk, and total records.",
        seo_title: "Weightlifting Records",
    },
    DataPageLink {
        path: "/wso-records",
        label: "WSO Records",
        description: "State-organization records by division and weight class.",
        seo_title: "USAW WSO Records",
    },
    DataPageLink {
        path: "/adaptive-records",
        label: "Adaptive Records",
        description: "Top adaptive performances by gender and weight class.",
        seo_title: "Adaptive Weightlifting Records",
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
    fn every_catalog_page_has_a_gated_route() {
        let routes = include_str!("../../main.rs");
        for page in DATA_PAGES {
            assert!(
                routes.contains(&format!("path!(\"{}\")", page.path)),
                "{} is missing from the router in main.rs",
                page.path
            );
        }
    }

    #[test]
    fn every_catalog_page_has_a_prerendered_seo_document() {
        let bootstrap = include_str!("../../../scripts/generate-bootstrap.sh");
        for page in DATA_PAGES {
            let stem = page.path.trim_start_matches('/');
            let escaped_title = page.seo_title.replace('&', "&amp;");
            let entry = format!("{stem}|{}|{escaped_title}", page.path);
            assert!(
                bootstrap.contains(&entry),
                "generate-bootstrap.sh is missing or out of sync for: {entry}"
            );
        }
    }
}
