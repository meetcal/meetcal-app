#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DataPageLink {
    pub path: &'static str,
    pub label: &'static str,
    pub heading: &'static str,
    pub intro: &'static str,
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

pub const QUALIFYING_TOTALS: DataPageLink = DataPageLink {
    path: "/qualifying-totals",
    label: "Qualifying Totals",
    heading: "Qualifying Totals",
    intro: "Filter qualification totals by event, gender, age category, or weight class.",
    description: "Qualification totals by event, division, and weight class.",
    seo_title: "Weightlifting Qualifying Totals",
    access: Access::Subscription,
};

pub const STANDARDS: DataPageLink = DataPageLink {
    path: "/standards",
    label: "Standards",
    heading: "Standards",
    intro: "A and B standards by gender, age category, and weight class.",
    description: "A and B standards by division and weight class.",
    seo_title: "Weightlifting Standards",
    access: Access::Subscription,
};

pub const RESULTS: DataPageLink = DataPageLink {
    path: "/results",
    label: "Results",
    heading: "Results",
    intro: "Search an athlete’s competition history.",
    description: "Search an athlete’s competition results from the last 20 years.",
    seo_title: "Athlete Competition Results",
    access: Access::Subscription,
};

pub const MEET_CENTER: DataPageLink = DataPageLink {
    path: "/meet-center",
    label: "Meets",
    heading: "Meets",
    intro: "Search all meets to see venue details, session schedules, start lists, and published results.",
    description: "Venue details, schedules, start lists, and complete meet results.",
    seo_title: "Weightlifting Meets, Schedules & Results",
    access: Access::Subscription,
};

pub const CLUB_DASHBOARD: DataPageLink = DataPageLink {
    path: "/club-dashboard",
    label: "Club Dashboard",
    heading: "Club Meet Dashboard",
    intro: "Review a club’s athletes, medals, PRs, make rates, and meet totals.",
    description: "Meet performance, medals, PRs, make rates, and athlete totals by club.",
    seo_title: "Weightlifting Club Meet Dashboard",
    access: Access::Subscription,
};

pub const WSO_DASHBOARD: DataPageLink = DataPageLink {
    path: "/wso-dashboard",
    label: "WSO Dashboard",
    heading: "WSO Meet Dashboard",
    intro: "See participation, make rates, lifted volume, and athlete totals for one WSO at a meet.",
    description: "Participation, make rates, lifted volume, and results for a selected WSO.",
    seo_title: "USAW WSO Meet Dashboard",
    access: Access::Subscription,
};

pub const WSO_ELITE: DataPageLink = DataPageLink {
    path: "/wso-elite",
    label: "WSO Elite",
    heading: "WSO Elite",
    intro: "Find a WSO’s top 20 women and men overall and in each age group, scored by % of A standard, Q-points, Q-masters, or Sinclair.",
    description: "A WSO's top athletes overall and by age group, by % of A, Q-points, or Sinclair.",
    seo_title: "USAW WSO Elite Athletes",
    access: Access::Subscription,
};

pub const WRAPPED: DataPageLink = DataPageLink {
    path: "/wrapped",
    label: "Athlete Wrapped",
    heading: "Athlete Wrapped",
    intro: "Summarize an athlete’s competition year, best lifts, make rate, and progress.",
    description: "Free yearly athlete recaps with best lifts, make rate, and progress.",
    seo_title: "Weightlifting Athlete Wrapped",
    access: Access::Free {
        seo_description: "Free Weightlifting Wrapped: an athlete's competition year in numbers, with meets, best lifts, make rate, and progress.",
    },
};

pub const RANKINGS: DataPageLink = DataPageLink {
    path: "/rankings",
    label: "Rankings",
    heading: "International Rankings",
    intro: "Browse current international rankings by meet, gender, age, or weight class.",
    description: "International rankings, totals, and percentage scores.",
    seo_title: "International Weightlifting Rankings",
    access: Access::Subscription,
};

pub const NATIONAL_RANKINGS: DataPageLink = DataPageLink {
    path: "/national-rankings",
    label: "National Rankings",
    heading: "National Rankings",
    intro: "Find each athlete’s best total for a USAW or USAMW division. Add a year to limit the rankings to that season.",
    description: "USAW and USAMW rankings by division, with optional year filtering.",
    seo_title: "National Weightlifting Rankings",
    access: Access::Subscription,
};

pub const RECORDS: DataPageLink = DataPageLink {
    path: "/records",
    label: "Records",
    heading: "Records",
    intro: "Filter record performances by organization, division, and weight class.",
    description: "Snatch, clean and jerk, and total records.",
    seo_title: "Weightlifting Records",
    access: Access::Subscription,
};

pub const WSO_RECORDS: DataPageLink = DataPageLink {
    path: "/wso-records",
    label: "WSO Records",
    heading: "WSO Records",
    intro: "Browse records published by USA Weightlifting state organizations.",
    description: "State-organization records by division and weight class.",
    seo_title: "USAW WSO Records",
    access: Access::Subscription,
};

pub const ADAPTIVE_RECORDS: DataPageLink = DataPageLink {
    path: "/adaptive-records",
    label: "Adaptive Records",
    heading: "Adaptive Records",
    intro: "Top USAW and USAMW adaptive performances by gender and weight class.",
    description: "Top adaptive performances by gender and weight class.",
    seo_title: "Adaptive Weightlifting Records",
    access: Access::Subscription,
};

pub const DATA_HOME: DataPageLink = DataPageLink {
    path: "/comp-data",
    label: "Competition Data",
    heading: "Find the Numbers You Need",
    intro: "Browse meets, team performance, athlete history, qualification data, rankings, and records.",
    description: "Every competition data page.",
    seo_title: "Competition Data",
    access: Access::Subscription,
};

pub const DATA_PAGES: [DataPageLink; 13] = [
    QUALIFYING_TOTALS,
    STANDARDS,
    RESULTS,
    MEET_CENTER,
    CLUB_DASHBOARD,
    WSO_DASHBOARD,
    WSO_ELITE,
    WRAPPED,
    RANKINGS,
    NATIONAL_RANKINGS,
    RECORDS,
    WSO_RECORDS,
    ADAPTIVE_RECORDS,
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
        let routes = include_str!("../../app.rs");
        for page in DATA_PAGES {
            let route = format!("path!(\"{}\")", page.path);
            let gated = format!("{route} view=|| view! {{ <SubscriptionGate page=catalog::");
            assert!(
                routes.contains(&route),
                "{} is missing from the router in app.rs",
                page.path
            );
            assert_eq!(
                routes.contains(&gated),
                page.access == Access::Subscription,
                "{} is gated in app.rs unlike its access, {:?}",
                page.path,
                page.access
            );
        }
    }

    #[test]
    fn every_catalog_page_has_a_page_shell_indexed_by_its_access() {
        let routes = include_str!("../../../shells/routes.txt");
        for page in DATA_PAGES.iter().chain([&DATA_HOME]) {
            let stem = page.path.trim_start_matches('/');
            let escaped_title = page.seo_title.replace('&', "&amp;");
            let robots = match page.access {
                Access::Subscription => "noindex, nofollow",
                Access::Free { .. } => "index, follow",
            };
            let line = routes
                .lines()
                .find(|line| line.starts_with(&format!("{stem}|{}|", page.path)))
                .unwrap_or_else(|| panic!("shells/routes.txt has no line for {}", page.path));
            assert!(line.contains(&escaped_title), "{line}");
            assert!(line.ends_with(robots), "{line}");
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
