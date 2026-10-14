use anyhow::{Result, bail};
use chrono::{Datelike, Local};
use clap::Parser;
use comfy_table::Table;

use crate::types::wrapped::{WrappedAnswer, WrappedStats};
use crate::utils::access::Access;
use crate::utils::backend::{convex_url, default_access, queries, query_from};
use crate::utils::output::{self, Report};
use crate::utils::stats::{fold, number, signed_kg};

/// The earliest and latest years `results:wrapped` answers for.
pub const WRAPPED_YEARS: std::ops::RangeInclusive<i64> = 1900..=2100;

/// Show an athlete's calendar year in lifting.
///
/// Examples:
///   meetcal wrapped "Maddisen Mohnsen"
///   meetcal wrapped "Maddisen Mohnsen" --year 2025
#[derive(Parser)]
#[command(name = "wrapped")]
pub struct WrappedArgs {
    /// Exact athlete name
    pub name: String,

    /// Calendar year to summarize (defaults to the current year)
    #[arg(long, short = 'y', value_parser = clap::value_parser!(i32).range(WRAPPED_YEARS))]
    pub year: Option<i32>,
}

pub async fn run(args: WrappedArgs) -> Result<()> {
    let year = args.year.unwrap_or_else(current_year);
    let answer = get_wrapped(&args.name, year).await?;
    let (display_name, stats) = athlete_year(&args.name, year, answer)?;
    output::emit(wrapped_report(&display_name, year, &stats));
    Ok(())
}

/// The year on the user's clock, the default for every "this year" report. Not UTC's: from
/// 7 pm Eastern on December 31 UTC is already in the next year.
pub fn current_year() -> i32 {
    Local::now().year()
}

/// `name`'s Wrapped for `year` from the server (`results:wrapped`). Free and public: it carries
/// no pass and no login.
pub async fn get_wrapped(name: &str, year: i32) -> Result<WrappedAnswer> {
    get_wrapped_from(&convex_url(), default_access(), name, year).await
}

/// [`get_wrapped`] from the deployment at `base_url`. `picked` asks for the exact (folded) name
/// only, as these commands take one: no name-contains fallback, just suggestions.
pub async fn get_wrapped_from(
    base_url: &str,
    access: &Access,
    name: &str,
    year: i32,
) -> Result<WrappedAnswer> {
    let args = serde_json::json!({ "query": name, "year": year, "picked": true });
    query_from(base_url, access, queries::WRAPPED, &args).await
}

/// The athlete's display name and stats from `answer`, or why there are none: a year with more
/// results than the server scores, no results (with suggestions other than the typed name), or a
/// name that matches several athletes.
pub fn athlete_year(
    name: &str,
    year: i32,
    answer: WrappedAnswer,
) -> Result<(String, WrappedStats)> {
    match answer {
        WrappedAnswer::Athlete { name, stats } => Ok((name, stats)),
        WrappedAnswer::NoResults { suggestions } => {
            let suggestions = other_names(name, suggestions);
            if suggestions.is_empty() {
                bail!("No results found for \"{name}\" in {year}");
            }
            bail!(
                "No exact results found for \"{name}\". Suggestions: {}",
                suggestions.join(", ")
            )
        }
        other => Err(unscored(name, year, other)),
    }
}

/// Why an answer that is neither an athlete's year nor "no results" has no stats.
pub fn unscored(name: &str, year: i32, answer: WrappedAnswer) -> anyhow::Error {
    match answer {
        WrappedAnswer::TooManyResults { name: athlete } => anyhow::anyhow!(
            "\"{athlete}\" has more results in {year} than one Wrapped scores, so the {year} \
             stats would be incomplete. `meetcal progress \"{athlete}\" --since {year}` lists \
             every result."
        ),
        WrappedAnswer::Ambiguous { names, truncated } => {
            let more = if truncated { ", and more" } else { "" };
            anyhow::anyhow!(
                "\"{name}\" matches several athletes: {}{more}. Use one exact name.",
                names.join(", ")
            )
        }
        WrappedAnswer::Narrow => anyhow::anyhow!(
            "\"{name}\" matches too many athletes to look at; type more of the name"
        ),
        WrappedAnswer::Athlete { .. } | WrappedAnswer::NoResults { .. } => {
            anyhow::anyhow!("No results found for \"{name}\" in {year}")
        }
    }
}

/// Suggestions other than the typed name itself: the server suggests the athlete's own name when
/// they have no results in the year, which is no suggestion.
pub fn other_names(name: &str, suggestions: Vec<String>) -> Vec<String> {
    let typed = fold(name);
    suggestions
        .into_iter()
        .filter(|suggestion| fold(suggestion) != typed)
        .collect()
}

pub fn render_wrapped_report(name: &str, year: i32, stats: &WrappedStats) -> String {
    wrapped_report(name, year, stats).to_text()
}

pub fn wrapped_report(name: &str, year: i32, stats: &WrappedStats) -> Report {
    let mut headline = Table::new();
    headline.set_header(vec!["Meets", "Make Rate", "Best Total", "Status"]);
    headline.add_row(vec![
        stats.total_meets.to_string(),
        format!("{:.1}%", stats.make_percentage),
        format!("{}kg", number(stats.best_total)),
        stats.year_rank.clone(),
    ]);

    let mut volume = Table::new();
    volume.set_header(vec![
        "Total Weight Lifted",
        "Best Snatch",
        "Best C&J",
        "Average Total",
    ]);
    volume.add_row(vec![
        format!("{}kg", number(stats.total_weight_lifted)),
        format!("{}kg", number(stats.best_snatch)),
        format!("{}kg", number(stats.best_clean_jerk)),
        format!("{}kg", number(stats.average_total)),
    ]);

    let mut journey = Table::new();
    journey.set_header(vec![
        "Top Meet",
        "First-to-Last Total",
        "Longest Make Streak",
        "Favorite Attempt",
    ]);
    journey.add_row(vec![
        stats.top_meet.clone().unwrap_or_else(|| "N/A".to_string()),
        signed_kg(stats.improvement_from_first),
        stats.longest_make_streak.to_string(),
        stats
            .favorite_attempt
            .map(ordinal)
            .unwrap_or_else(|| "N/A".to_string()),
    ]);

    Report::new()
        .titled(format!("{year} WEIGHTLIFTING WRAPPED — {name}"))
        .table("headline", headline)
        .table("volume", volume)
        .table("journey", journey)
}

fn ordinal(attempt: usize) -> String {
    match attempt {
        1 => "1st".to_string(),
        2 => "2nd".to_string(),
        3 => "3rd".to_string(),
        _ => attempt.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn stats() -> WrappedStats {
        WrappedStats {
            total_weight_lifted: 1275.0,
            total_meets: 2,
            make_percentage: 250.0 / 3.0,
            best_snatch: 113.0,
            best_clean_jerk: 150.0,
            best_total: 263.0,
            average_total: 262.5,
            top_meet: Some("2024 Carolinas WSO Championships".to_string()),
            improvement_from_first: Some(1.0),
            longest_make_streak: 8,
            favorite_attempt: Some(1),
            year_rank: "Rising Star".to_string(),
        }
    }

    /// An answer as Convex's HTTP API writes it: every number a float.
    fn parse(value: serde_json::Value) -> WrappedAnswer {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn reads_the_servers_athlete_answer() {
        let answer = parse(json!({
            "kind": "athlete",
            "name": "Maddisen Mohnsen",
            "stats": {
                "averageTotal": 262.5, "bestCleanJerk": 150, "bestSnatch": 113, "bestTotal": 263,
                "favoriteAttempt": 1, "improvementFromFirst": 1, "longestMakeStreak": 8,
                "makePercentage": 83.33333333333333, "topMeet": "2024 Carolinas WSO Championships",
                "totalMeets": 2, "totalWeightLifted": 1275, "yearRank": "Rising Star"
            }
        }));
        let (name, read) = athlete_year("maddisen  mohnsen", 2024, answer).unwrap();
        assert_eq!(name, "Maddisen Mohnsen");
        assert_eq!(read, stats());
    }

    #[test]
    fn reads_nulls_and_every_other_kind() {
        let answer = parse(json!({
            "kind": "athlete", "name": "A", "stats": {
                "averageTotal": 0, "bestCleanJerk": 0, "bestSnatch": 0, "bestTotal": 0,
                "favoriteAttempt": null, "improvementFromFirst": null, "longestMakeStreak": 0,
                "makePercentage": 0, "topMeet": null, "totalMeets": 1, "totalWeightLifted": 0,
                "yearRank": "Rising Star"
            }
        }));
        let WrappedAnswer::Athlete { stats, .. } = answer else {
            panic!("expected an athlete");
        };
        assert_eq!(stats.top_meet, None);
        assert_eq!(stats.favorite_attempt, None);
        assert_eq!(stats.improvement_from_first, None);

        assert_eq!(
            parse(json!({"kind": "ambiguous", "names": ["A", "B"], "truncated": true})),
            WrappedAnswer::Ambiguous {
                names: vec!["A".into(), "B".into()],
                truncated: true
            }
        );
        assert_eq!(parse(json!({"kind": "narrow"})), WrappedAnswer::Narrow);
        assert_eq!(
            parse(json!({"kind": "tooManyResults", "name": "A"})),
            WrappedAnswer::TooManyResults { name: "A".into() }
        );
        assert_eq!(
            parse(json!({"kind": "none", "suggestions": ["A"]})),
            WrappedAnswer::NoResults {
                suggestions: vec!["A".into()]
            }
        );
        assert!(serde_json::from_value::<WrappedAnswer>(json!({"kind": "other"})).is_err());
    }

    #[test]
    fn the_typed_name_is_no_suggestion() {
        let answer = WrappedAnswer::NoResults {
            suggestions: vec!["Maddisen Mohnsen".into()],
        };
        let error = athlete_year("maddisen  mohnsen", 2025, answer)
            .unwrap_err()
            .to_string();
        assert_eq!(error, "No results found for \"maddisen  mohnsen\" in 2025");
        assert_eq!(
            other_names("Ada", vec!["ADA".into(), "Adam".into()]),
            ["Adam"]
        );
    }

    #[test]
    fn no_results_lists_the_other_names() {
        let answer = WrappedAnswer::NoResults {
            suggestions: vec!["Jane Doe".into(), "Janet Doe".into()],
        };
        let error = athlete_year("Janet Doe", 2026, answer)
            .unwrap_err()
            .to_string();
        assert_eq!(
            error,
            "No exact results found for \"Janet Doe\". Suggestions: Jane Doe"
        );
    }

    #[test]
    fn refuses_a_year_with_too_many_results() {
        let answer = WrappedAnswer::TooManyResults {
            name: "Jane Doe".into(),
        };
        let error = athlete_year("jane doe", 2026, answer)
            .unwrap_err()
            .to_string();
        assert!(error.contains("more results in 2026"));
        assert!(error.contains("meetcal progress \"Jane Doe\" --since 2026"));
    }

    #[test]
    fn several_or_too_many_matches_ask_for_one_name() {
        let error = athlete_year(
            "Doe",
            2026,
            WrappedAnswer::Ambiguous {
                names: vec!["Jane Doe".into(), "John Doe".into()],
                truncated: true,
            },
        )
        .unwrap_err()
        .to_string();
        assert!(error.contains("Jane Doe, John Doe, and more"));
        let error = athlete_year("Doe", 2026, WrappedAnswer::Narrow)
            .unwrap_err()
            .to_string();
        assert!(error.contains("type more of the name"));
    }

    #[test]
    fn renders_every_app_metric() {
        let report = render_wrapped_report("Jane Doe", 2026, &stats());

        for text in [
            "2026 WEIGHTLIFTING WRAPPED — Jane Doe",
            "Total Weight Lifted",
            "Best Snatch",
            "Best C&J",
            "Average Total",
            "Top Meet",
            "First-to-Last Total",
            "Longest Make Streak",
            "Favorite Attempt",
            "83.3%",
            "1st",
            "Rising Star",
        ] {
            assert!(report.contains(text), "report omitted {text}");
        }
    }

    #[test]
    fn an_improvement_shows_its_sign_and_its_absence_na() {
        let mut improved = stats();
        improved.improvement_from_first = Some(15.0);
        let json = wrapped_report("Jane Doe", 2026, &improved).to_json();
        assert_eq!(json["journey"][0]["first_to_last_total"], 15);
        assert!(render_wrapped_report("Jane Doe", 2026, &improved).contains("+15kg"));

        let one_meet = WrappedStats {
            improvement_from_first: None,
            top_meet: None,
            favorite_attempt: None,
            ..stats()
        };
        let text = render_wrapped_report("Jane Doe", 2026, &one_meet);
        assert!(text.contains("N/A"));
        assert!(!text.contains("0kg |"));
    }
}
