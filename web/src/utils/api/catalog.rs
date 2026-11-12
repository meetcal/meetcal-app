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
}

impl Query {
    pub(crate) fn is_premium(self) -> bool {
        SUBSCRIPTION_FUNCTIONS.contains(&self.function)
    }

    pub(super) const fn value(function: &'static str) -> Self {
        Self {
            function,
            body: Body::Value,
        }
    }

    pub(super) const fn text(function: &'static str) -> Self {
        Self {
            function,
            body: Body::JsonText,
        }
    }
}

pub(crate) mod queries {
    use super::Query;

    pub(crate) const UPCOMING_MEETS: Query = Query::text("meets:list");
    pub(crate) const COMPLETED_MEETS: Query = Query::text("meets:completed");
    pub(crate) const MEET_SCHEDULE: Query = Query::text("meets:schedule");
    pub(crate) const MEET_ATHLETES: Query = Query::text("meets:athletes");
    pub(crate) const MEET_RESULTS: Query = Query::text("results:byMeet");
    pub(crate) const SEARCH: Query = Query::value("results:search");
    pub(crate) const ATHLETE: Query = Query::value("results:athlete");
    pub(crate) const RECORDS: Query = Query::text("reference:records");
    pub(crate) const STANDARDS: Query = Query::text("reference:standards");
    pub(crate) const QUALIFYING_TOTALS: Query = Query::text("reference:qualifyingTotals");
    pub(crate) const INTL_RANKINGS: Query = Query::text("reference:intlRankings");
    pub(crate) const NATIONAL_RANKINGS: Query = Query::text("reference:nationalRankings");
    pub(crate) const NATIONAL_RANKINGS_BY_YEAR: Query =
        Query::text("reference:nationalRankingsByYear");
    pub(crate) const WSO_LIST: Query = Query::text("reference:wsoList");
    pub(crate) const REGISTRATION_WSOS: Query = Query::value("reference:registrationWsos");
    pub(crate) const WSO_RECORDS: Query = Query::text("reference:wsoRecords");
    pub(crate) const ADAPTIVE_RECORDS: Query = Query::text("reference:adaptiveRecords");
    pub(crate) const CLUBS: Query = Query::text("reference:clubs");
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
