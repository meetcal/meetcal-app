use anyhow::Result;
use clap::Parser;
use comfy_table::Table;
use serde::Deserialize;

use crate::utils::backend::{NoArgs, queries, query};
use crate::utils::filters::{Filter, no_match};
use crate::utils::output::{self, Report};
use crate::utils::stats::{number, weight_class};

#[derive(Debug, Deserialize)]
pub struct Standards {
    pub weight_class: String,
    pub standard_a: f64,
    pub standard_b: f64,
    pub age_category: String,
    pub gender: String,
}

/// Search for A/B USAW Standards for a given age and gender group.
///
/// Examples:
///   meetcal standards --age Senior --gender Men
#[derive(Parser)]
#[command(name = "standards")]
pub struct StandardsArgs {
    /// Age group: U15, Youth, Junior, or Senior
    #[arg(long, short = 'a')]
    pub age: String,

    /// Gender: Men or Women
    #[arg(long, short = 'g')]
    pub gender: String,
}

pub async fn run(args: StandardsArgs) -> Result<()> {
    // assign args to vars
    let age = args.age;
    let gender = args.gender;
    let standards: Vec<Standards> = query(queries::STANDARDS, &NoArgs {}).await?;
    let (filtered, others): (Vec<Standards>, Vec<Standards>) =
        standards.into_iter().partition(|row| {
            row.age_category.eq_ignore_ascii_case(age.trim())
                && row.gender.eq_ignore_ascii_case(gender.trim())
        });
    if filtered.is_empty() {
        let filters = [
            Filter {
                option: "--age",
                value: &age,
            },
            Filter {
                option: "--gender",
                value: &gender,
            },
        ];
        let rows: Vec<Vec<&str>> = others
            .iter()
            .map(|row| vec![row.age_category.as_str(), row.gender.as_str()])
            .collect();
        return Err(no_match("standards", &filters, &rows));
    }
    let (table, data) = tables(&lightest_first(filtered));
    output::emit(Report::new().table_with_data("standards", table, data));

    Ok(())
}

/// The standards for one age group and gender, lightest class first.
pub fn selected(standards: Vec<Standards>, age: &str, gender: &str) -> Vec<Standards> {
    lightest_first(
        standards
            .into_iter()
            .filter(|row| {
                row.age_category.eq_ignore_ascii_case(age)
                    && row.gender.eq_ignore_ascii_case(gender)
            })
            .collect(),
    )
}

/// Standards lightest class first (then by A total, so the 2025 and Aug-2026 class sets
/// interleave by weight).
fn lightest_first(mut standards: Vec<Standards>) -> Vec<Standards> {
    standards.sort_by(|a, b| {
        class_key(&a.weight_class)
            .partial_cmp(&class_key(&b.weight_class))
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.standard_a.total_cmp(&b.standard_a))
    });
    standards
}

/// How a class sorts: classes that hold no weight last, then by weight, a `+` class after the
/// class of its number.
fn class_key(class: &str) -> (bool, f64, bool) {
    match weight_class(class) {
        Some(class) => {
            let plus = class.ends_with('+');
            let weight = class.trim_end_matches('+').parse().unwrap_or(f64::MAX);
            (false, weight, plus)
        }
        None => (true, 0.0, false),
    }
}

/// The table as shown (a missing level as a dash) and as exported (a missing level empty, so
/// JSON has null rather than a 0 that reads as a real standard).
fn tables(standards: &[Standards]) -> (Table, Table) {
    let mut table = Table::new();
    let mut data = Table::new();
    table.set_header(vec!["Class", "A", "B"]);
    data.set_header(vec!["Class", "A", "B"]);
    let level = |value: f64, missing: &str| {
        if value > 0.0 {
            number(value)
        } else {
            missing.to_string()
        }
    };
    for row in standards {
        table.add_row(vec![
            row.weight_class.clone(),
            level(row.standard_a, "—"),
            level(row.standard_b, "—"),
        ]);
        data.add_row(vec![
            row.weight_class.clone(),
            level(row.standard_a, ""),
            level(row.standard_b, ""),
        ]);
    }
    (table, data)
}

#[cfg(test)]
mod tests {
    use super::*;

    const JSON: &str = r#"[
        {
            "weight_class": "Senior",
            "standard_a": 140,
            "standard_b": 120,
            "age_category": "Senior",
            "gender": "Men"
        },
        {
            "weight_class": "Senior",
            "standard_a": 130,
            "standard_b": 110,
            "age_category": "Senior",
            "gender": "Men"
        }
    ]"#;

    #[test]
    fn parse_backend_response() {
        let standards: Vec<Standards> = serde_json::from_str(JSON).unwrap();

        let row = &standards[0];

        assert_eq!(row.weight_class, "Senior");
        assert_eq!(row.standard_a, 140.0);
        assert_eq!(row.standard_b, 120.0);
    }

    fn standard(class: &str, a: f64, b: f64) -> Standards {
        Standards {
            weight_class: class.into(),
            standard_a: a,
            standard_b: b,
            age_category: "U15".into(),
            gender: "Men".into(),
        }
    }

    #[test]
    fn sorting() {
        // 56kg has a lower A than 55kg (two class sets), and +94/+95 tie on A.
        let standards = vec![
            standard("+95kg", 310.0, 0.0),
            standard("60kg", 197.0, 0.0),
            standard("56kg", 181.0, 0.0),
            standard("+94kg", 310.0, 0.0),
            standard("55kg", 184.0, 0.0),
            standard("Open", 1.0, 0.0),
        ];
        let classes: Vec<String> = selected(standards, "u15", "men")
            .into_iter()
            .map(|row| row.weight_class)
            .collect();
        assert_eq!(classes, ["55kg", "56kg", "60kg", "+94kg", "+95kg", "Open"]);
    }

    #[test]
    fn a_missing_level_is_no_standard() {
        let report = {
            let (table, data) = tables(&[standard("55kg", 184.0, 0.0)]);
            Report::new().table_with_data("standards", table, data)
        };
        assert_eq!(report.to_json()[0]["b"], serde_json::Value::Null);
        assert_eq!(report.to_json()[0]["a"], 184);
        assert!(report.to_text().contains('—'));
    }

    #[test]
    fn rejects_missing_field() {
        let bad_json = r#"[
            {
                "weight_class": "Senior",
                "standard_a": 140
            }
        ]"#;

        let result: Result<Vec<Standards>, _> = serde_json::from_str(bad_json);
        assert!(result.is_err());
    }
}
