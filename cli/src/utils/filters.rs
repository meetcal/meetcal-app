//! Checking filter options: dates and age categories are parsed before any request, and the
//! reference commands, which filter a whole table locally, say which filter matched nothing
//! rather than printing an empty table and exiting 0.

use anyhow::{Error, Result, anyhow, bail};
use chrono::NaiveDate;

/// The age categories `--category` takes, as divisions are labelled (`stats::Division`).
pub const CATEGORIES: &str =
    "Senior, Junior, U17 (or Youth), U15, U13, U11, or Masters 30 … Masters 95";

/// A date option's value as `YYYY-MM-DD`. Takes `2026-09-25` or the way tables show dates,
/// `Sep 25, 2026`; for clap's `value_parser`, so a bad value fails before any request.
pub fn parse_date(value: &str) -> Result<String, String> {
    let value = value.trim();
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .or_else(|_| NaiveDate::parse_from_str(value, "%b %d, %Y"))
        .map(|date| date.format("%Y-%m-%d").to_string())
        .map_err(|_| "expected a date as YYYY-MM-DD, like 2026-06-20".to_string())
}

/// The error for a `--federation` no row in the range has, naming the ones that do; `None`
/// when some row has it (or no federation was asked for).
pub fn unknown_federation<'a>(
    federation: Option<&str>,
    federations: impl IntoIterator<Item = &'a str>,
) -> Option<Error> {
    let wanted = federation?.trim();
    let mut present: Vec<&str> = federations.into_iter().collect();
    if present.iter().any(|f| f.eq_ignore_ascii_case(wanted)) {
        return None;
    }
    present.sort_unstable();
    present.dedup();
    present.retain(|f| !f.trim().is_empty());
    Some(if present.is_empty() {
        anyhow!("No results in that range.")
    } else {
        anyhow!(
            "No results from federation \"{wanted}\" in that range. Its federations: {}",
            present.join(", ")
        )
    })
}

/// An age category as division labels name it: `Senior`, `Junior`, `U17` … `U11`, or
/// `Masters 45`. Case and spacing are ignored, `Open` is `Senior` and `Youth` (the standards'
/// name) is `U17`; anything else is an error listing what is accepted.
pub fn category(value: &str) -> Result<String> {
    let compact: String = value
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_ascii_lowercase();
    let label = match compact.as_str() {
        "senior" | "open" => Some("Senior".to_string()),
        "junior" => Some("Junior".to_string()),
        "u17" | "youth" | "16-17" => Some("U17".to_string()),
        "u15" | "14-15" => Some("U15".to_string()),
        "u13" => Some("U13".to_string()),
        "u11" => Some("U11".to_string()),
        other => other
            .strip_prefix("masters")
            .and_then(|age| age.parse::<u32>().ok())
            .filter(|age| (30..=95).contains(age) && age % 5 == 0)
            .map(|age| format!("Masters {age}")),
    };
    match label {
        Some(label) => Ok(label),
        None => bail!(
            "Unknown age category \"{}\"; use {CATEGORIES}",
            value.trim()
        ),
    }
}

/// One filter a command applied: its option (`--age`) and the value given.
pub struct Filter<'a> {
    pub option: &'a str,
    pub value: &'a str,
}

/// The error for filters that matched no row of `what` (`"standards"`). `rows` holds each row's
/// values for the filters, in the filters' order; values compare ignoring case and surrounding
/// space, as the commands filter. Names the first filter no row matches given the ones before
/// it, with the values those rows do have.
pub fn no_match(what: &str, filters: &[Filter], rows: &[Vec<&str>]) -> Error {
    let same = |a: &str, b: &str| a.trim().eq_ignore_ascii_case(b.trim());
    let mut remaining: Vec<&Vec<&str>> = rows.iter().collect();
    for (index, filter) in filters.iter().enumerate() {
        let matching: Vec<&Vec<&str>> = remaining
            .iter()
            .copied()
            .filter(|row| {
                row.get(index)
                    .is_some_and(|value| same(value, filter.value))
            })
            .collect();
        if !matching.is_empty() {
            remaining = matching;
            continue;
        }
        let mut available: Vec<&str> = remaining
            .iter()
            .filter_map(|row| row.get(index).copied())
            .filter(|value| !value.trim().is_empty())
            .collect();
        available.sort_by_key(|value| value.to_lowercase());
        available.dedup_by(|a, b| same(a, b));
        let given: Vec<String> = filters[..index]
            .iter()
            .map(|earlier| format!("{} {}", earlier.option, earlier.value))
            .collect();
        let scope = if given.is_empty() {
            String::new()
        } else {
            format!(" with {}", given.join(" "))
        };
        if available.is_empty() {
            return anyhow!("No {what} found{scope}.");
        }
        return anyhow!(
            "No {what} for {} \"{}\"{scope}. Try one of: {}",
            filter.option,
            filter.value,
            available.join(", ")
        );
    }
    anyhow!("No {what} match those filters.")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_take_iso_or_the_shown_format() {
        assert_eq!(parse_date("2026-09-25"), Ok("2026-09-25".to_string()));
        assert_eq!(parse_date(" Sep 25, 2026 "), Ok("2026-09-25".to_string()));
        assert_eq!(parse_date("Sep 5, 2026"), Ok("2026-09-05".to_string()));
        assert!(parse_date("garbage").is_err());
        assert!(parse_date("2026-13-45").is_err());
        assert!(parse_date("2026-02-30").is_err());
    }

    #[test]
    fn an_unknown_federation_names_the_ones_present() {
        let rows = ["USAW", "USAMW", "USAW"];
        assert!(unknown_federation(None, rows).is_none());
        assert!(unknown_federation(Some("usaw"), rows).is_none());
        assert_eq!(
            unknown_federation(Some("zzz"), rows).unwrap().to_string(),
            "No results from federation \"zzz\" in that range. Its federations: USAMW, USAW"
        );
    }

    #[test]
    fn categories_are_normalized_or_refused() {
        assert_eq!(category("senior").unwrap(), "Senior");
        assert_eq!(category("Open").unwrap(), "Senior");
        assert_eq!(category("Youth").unwrap(), "U17");
        assert_eq!(category("u15").unwrap(), "U15");
        assert_eq!(category("Masters45").unwrap(), "Masters 45");
        assert_eq!(category("masters 35").unwrap(), "Masters 35");
        assert!(category("Masters 37").is_err());
        let error = category("Junk").unwrap_err().to_string();
        assert!(error.starts_with("Unknown age category \"Junk\"; use Senior, Junior"));
    }

    fn rows() -> Vec<Vec<&'static str>> {
        vec![
            vec!["Senior", "Men", "Nationals"],
            vec!["Junior", "Men", "Nationals"],
            vec!["Senior", "Women", "American Open Finals"],
            vec!["Senior", "Men", "American Open Finals"],
        ]
    }

    fn filters<'a>(age: &'a str, gender: &'a str, event: &'a str) -> Vec<Filter<'a>> {
        vec![
            Filter {
                option: "--age",
                value: age,
            },
            Filter {
                option: "--gender",
                value: gender,
            },
            Filter {
                option: "--event",
                value: event,
            },
        ]
    }

    #[test]
    fn names_the_first_filter_that_matches_nothing() {
        let error = no_match("totals", &filters("Senoir", "Men", "Nationals"), &rows());
        assert_eq!(
            error.to_string(),
            "No totals for --age \"Senoir\". Try one of: Junior, Senior"
        );
    }

    #[test]
    fn lists_what_the_earlier_filters_leave() {
        let error = no_match("totals", &filters("senior", "Women", "Nationals"), &rows());
        assert_eq!(
            error.to_string(),
            "No totals for --event \"Nationals\" with --age senior --gender Women. Try one of: \
             American Open Finals"
        );
    }

    #[test]
    fn says_when_there_is_nothing_at_all() {
        let error = no_match("totals", &filters("Senior", "Men", "Nationals"), &[]);
        assert_eq!(error.to_string(), "No totals found.");
    }
}
