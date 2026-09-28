use std::sync::LazyLock;

use anyhow::Result;
use clap::Parser;
use comfy_table::Table;
use regex::Regex;

use crate::types::lifting_results::AdaptiveRecord;
use crate::utils::api::get_api_response_with_query;

static MEN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\bmen\b").unwrap());
static WOMEN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\bwomen\b").unwrap());
static YEAR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b\d{4}\b").unwrap());
static WEIGHT_CLASS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\b(\d+\+?)kg").unwrap());

/// Search for Adaptive American Records for a given weight class and gender.
///
/// Examples:
///   meetcal adaptive-records Women
#[derive(Parser)]
#[command(name = "adaptive-records")]
pub struct AdaptiveArgs {
    /// Gender: Men or Women
    pub gender: String,
}

pub async fn run(args: AdaptiveArgs) -> Result<()> {
    let gender = args.gender;

    let query_args = [
        ("exclude_federation", "BWL".to_string()),
        ("gender", gender),
    ];
    let records: Vec<AdaptiveRecord> =
        get_api_response_with_query("/data/adaptive", &query_args).await?;

    let mut table = Table::new();

    table.set_header(vec!["Weight Class", "Snatch", "CJ", "Total"]);

    for record in records {
        table.add_row(vec![
            record.weight_class.to_string(),
            record.snatch.to_string(),
            record.cj.to_string(),
            record.total.to_string(),
        ]);
    }

    println!("{table}");

    Ok(())
}

pub fn extract_gender(age: &str, gender: &str) -> bool {
    // Age in the db is a combo of age and weight class
    // Open Women's 86kg, Master's (40-44) Men's 95kg
    if gender.eq_ignore_ascii_case("men") {
        MEN.is_match(age) && !WOMEN.is_match(age)
    } else {
        WOMEN.is_match(age)
    }
}

pub fn extract_year(date: &str) -> u32 {
    // get year from date string
    YEAR.find(date)
        .and_then(|matched| matched.as_str().parse().ok())
        .unwrap_or(0)
}

pub fn extract_class(age: &str) -> Option<String> {
    // weight class is last portion of age db column
    // get numbers before kg, including + if there
    WEIGHT_CLASS
        .captures_iter(age)
        .filter_map(|cap| {
            let matched = cap.get(1)?;
            if is_inside_parens(age, matched.start()) {
                return None;
            }
            Some(matched.as_str().to_string())
        })
        .next()
}

fn is_inside_parens(text: &str, index: usize) -> bool {
    let before = &text[..index];
    let Some(open) = before.rfind('(') else {
        return false;
    };

    !before[open..].contains(')')
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_extract_gender() {
        assert!(extract_gender("Women", "Open Women's 77kg"));
    }

    #[test]
    fn test_extract_year() {
        assert_eq!(extract_year("2026/05/01"), 2026);
        assert_eq!(extract_year("2026-05-01"), 2026);
    }

    #[test]
    fn test_extract_class() {
        assert_eq!(extract_class("Open Women's 77kg"), Some(String::from("77")));
        assert_eq!(
            extract_class("Open Men's 110+kg"),
            Some(String::from("110+"))
        );
        assert_eq!(
            extract_class("Master's (35-39) Men's 60kg"),
            Some(String::from("60"))
        );
        assert_eq!(
            extract_class("Under 13 Age Group Women's 32kg"),
            Some(String::from("32"))
        );
    }
}
