use serde::Deserialize;

use super::lifting_results::LiftingResults;

#[derive(Debug, Deserialize)]
pub struct SearchResponse {
    pub matched_name: Option<String>,
    pub suggestions: Vec<String>,
    pub results: Vec<LiftingResults>,
    /// More results matched than the answer holds (it keeps the most recent).
    #[serde(default)]
    pub truncated: bool,
}

/// A calendar year's Wrapped numbers. For an athlete they are the server's (`results:wrapped`,
/// whose rules are `convex/lib/wrapped.ts`); club and WSO reports score their rows locally
/// (`group_wrapped::calculate_wrapped_stats`) into the same shape.
#[derive(Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WrappedStats {
    pub total_weight_lifted: f64,
    pub total_meets: usize,
    /// Made attempts over taken attempts, 0–100.
    pub make_percentage: f64,
    pub best_snatch: f64,
    pub best_clean_jerk: f64,
    pub best_total: f64,
    pub average_total: f64,
    /// The meet with the year's best total.
    pub top_meet: Option<String>,
    /// First meet's total to the last meet's; `None` with fewer than two meets with a total.
    pub improvement_from_first: Option<f64>,
    /// The longest run of made attempts, in competition order.
    pub longest_make_streak: usize,
    /// The attempt (1, 2 or 3) made most often; `None` when none was made.
    pub favorite_attempt: Option<usize>,
    /// "Consistency King", "Heavy Hitter", "Meet Regular" or "Rising Star".
    pub year_rank: String,
}

/// `results:wrapped`'s answer for one name and year, by its `kind`.
#[derive(Debug, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WrappedAnswer {
    /// One athlete's year, under the athlete's own spelling.
    Athlete { name: String, stats: WrappedStats },
    /// Several athletes matched (or may have: `truncated`). With `picked`, the server takes only
    /// the exact name, so this answers an unpicked query only.
    Ambiguous {
        names: Vec<String>,
        #[serde(default)]
        truncated: bool,
    },
    /// The name matched too many names to look at: type more of it.
    Narrow,
    /// The athlete's year has more results than one answer holds, so the stats would miss some.
    TooManyResults { name: String },
    /// No results in the year; `suggestions` are names like the query (any year).
    #[serde(rename = "none")]
    NoResults {
        #[serde(default)]
        suggestions: Vec<String>,
    },
}
