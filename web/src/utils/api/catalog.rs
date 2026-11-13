use serde_json::Value;
use std::time::Duration;

pub(crate) const SUBSCRIPTION_FUNCTIONS: &[&str] = &[
    "reference:records",
    "reference:recordCategories",
    "reference:standards",
    "reference:qualifyingTotals",
    "reference:qualifyingTotalCategories",
    "reference:intlRankings",
    "reference:nationalRankings",
    "reference:nationalRankingsByYear",
    "reference:wsoList",
    "reference:registrationWsos",
    "reference:wsoAgeGroups",
    "reference:wsoRecords",
    "reference:adaptiveRecords",
    "reference:clubs",
    "reference:clubAthletes",
    "reference:clubMeets",
    "reference:wsoAthletes",
    "reference:clubMeetStats",
    "reference:wsoMeetStats",
    "results:byMeet",
    "results:meetSummaries",
    "results:byNames",
    "results:recent",
    "results:yearBests",
    "results:bests",
    "results:groupMedals",
    "results:athlete",
    "results:search",
    "meets:packageForMeet",
];

pub(crate) const SUBSCRIPTION_ACTIONS: &[&str] = &["results:leaderboard", "results:wsoElite"];

pub(super) const SEARCH_FUNCTION: &str = "results:search";
pub(super) const SEARCH_DATE_ARGUMENTS: [&str; 2] = ["startDate", "endDate"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Body {
    Value,
    JsonText,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Query {
    pub function: &'static str,
    pub body: Body,
    pub revalidates: bool,
}

impl Query {
    pub(crate) fn is_premium(self) -> bool {
        SUBSCRIPTION_FUNCTIONS.contains(&self.function)
    }

    pub(super) const fn value(function: &'static str) -> Self {
        Self {
            function,
            body: Body::Value,
            revalidates: false,
        }
    }

    pub(super) const fn tagged(function: &'static str) -> Self {
        Self {
            function,
            body: Body::JsonText,
            revalidates: true,
        }
    }
}

pub(crate) mod queries {
    use super::Query;

    pub(crate) const UPCOMING_MEETS: Query = Query::tagged("meets:list");
    pub(crate) const COMPLETED_MEETS: Query = Query::tagged("meets:completed");
    pub(crate) const MEET_SCHEDULE: Query = Query::tagged("meets:schedule");
    pub(crate) const MEET_ATHLETES: Query = Query::tagged("meets:athletes");
    pub(crate) const MEET_RESULTS: Query = Query::tagged("results:byMeet");
    pub(crate) const SEARCH: Query = Query::value("results:search");
    pub(crate) const ATHLETE: Query = Query::value("results:athlete");
    pub(crate) const RECORDS: Query = Query::tagged("reference:records");
    pub(crate) const RECORD_CATEGORIES: Query = Query::tagged("reference:recordCategories");
    pub(crate) const QUALIFYING_TOTAL_CATEGORIES: Query =
        Query::tagged("reference:qualifyingTotalCategories");
    pub(crate) const STANDARDS: Query = Query::tagged("reference:standards");
    pub(crate) const QUALIFYING_TOTALS: Query = Query::tagged("reference:qualifyingTotals");
    pub(crate) const INTL_RANKINGS: Query = Query::tagged("reference:intlRankings");
    pub(crate) const NATIONAL_RANKINGS: Query = Query::tagged("reference:nationalRankings");
    pub(crate) const NATIONAL_RANKINGS_BY_YEAR: Query =
        Query::tagged("reference:nationalRankingsByYear");
    pub(crate) const WSO_LIST: Query = Query::tagged("reference:wsoList");
    pub(crate) const REGISTRATION_WSOS: Query = Query::value("reference:registrationWsos");
    pub(crate) const WSO_RECORDS: Query = Query::tagged("reference:wsoRecords");
    pub(crate) const ADAPTIVE_RECORDS: Query = Query::tagged("reference:adaptiveRecords");
    pub(crate) const CLUBS: Query = Query::tagged("reference:clubs");
    pub(crate) const CLUB_MEETS: Query = Query::value("reference:clubMeets");
    pub(crate) const CLUB_MEET_STATS: Query = Query::value("reference:clubMeetStats");
    pub(crate) const WRAPPED: Query = Query::value("results:wrapped");
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Action {
    pub function: &'static str,
    pub timeout: Duration,
}

pub(crate) mod actions {
    use super::{Action, Duration};

    pub(crate) const WSO_ELITE: Action = Action {
        function: "results:wsoElite",
        timeout: Duration::from_secs(120),
    };
}

pub(super) fn carries_pass(query: Query, args: &Value) -> bool {
    query.is_premium()
        && (query.function != SEARCH_FUNCTION
            || SEARCH_DATE_ARGUMENTS
                .iter()
                .all(|name| args.get(name).is_some_and(|value| !value.is_null())))
}
