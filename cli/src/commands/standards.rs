use anyhow::Result;
use clap::Parser;
use comfy_table::Table;
use serde::Deserialize;

use crate::utils::api::get_api_response;

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
    let standards: Vec<Standards> = get_api_response("/data/standards").await?;
    let mut filtered: Vec<Standards> = standards
        .into_iter()
        .filter(|row| {
            row.age_category.eq_ignore_ascii_case(&age) && row.gender.eq_ignore_ascii_case(&gender)
        })
        .collect();

    // sort by weight class low to high
    filtered.sort_by(|a, b| a.standard_a.total_cmp(&b.standard_a));

    // push to table
    let mut table = Table::new();
    table.set_header(vec!["Class", "A", "B"]);

    for total in filtered {
        table.add_row(vec![
            total.weight_class,
            total.standard_a.to_string(),
            total.standard_b.to_string(),
        ]);
    }

    println!("{table}");

    Ok(())
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

    #[test]
    fn sorting() {
        let mut standards: Vec<Standards> = serde_json::from_str(JSON).unwrap();
        standards.sort_by(|a, b| a.standard_a.total_cmp(&b.standard_a));

        assert_eq!(standards[0].standard_a, 130.0);
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
