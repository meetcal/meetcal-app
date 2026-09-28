use anyhow::Result;
use clap::Parser;
use comfy_table::Table;
use serde::Deserialize;

use crate::utils::api::get_api_response;

#[derive(Debug, Deserialize)]
pub struct QualifyingTotal {
    pub qualifying_total: f64,
    pub event_name: String,
    pub gender: String,
    pub age_category: String,
    pub weight_class: String,
}

/// Search for Qualifying Totals for a given age, gender, and event.
///
/// Examples:
///   meetcal qualifying-totals --age Senior --gender Men --event Nationals
#[derive(Parser)]
#[command(name = "qualifying-totals")]
pub struct QualTotalsArgs {
    /// Age group: U11, U13, U15, U17, U23, U25, Junior, University, Senior,
    /// Masters 35, Masters 40, Masters 45, Masters 50, Masters 55, Masters 60,
    /// Masters 65, Masters 70, Masters 75, Masters 80, Masters 85, or Masters 90
    #[arg(long, short = 'a')]
    pub age: String,

    /// Gender: Men or Women
    #[arg(long, short = 'g')]
    pub gender: String,

    /// Event to search for
    #[arg(long, short = 'e')]
    pub event: String,
}

pub async fn run(args: QualTotalsArgs) -> Result<()> {
    // assign args to vars
    let age = args.age;
    let gender = args.gender;
    let event = args.event;

    let totals: Vec<QualifyingTotal> = get_api_response("/data/qualifying-totals").await?;

    // push to table
    let mut table = Table::new();
    table.set_header(vec!["Class", "Total"]);

    for total in totals.into_iter().filter(|row| {
        row.age_category.eq_ignore_ascii_case(&age)
            && row.gender.eq_ignore_ascii_case(&gender)
            && row.event_name.eq_ignore_ascii_case(&event)
    }) {
        table.add_row(vec![total.weight_class, total.qualifying_total.to_string()]);
    }

    println!("{table}");

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const JSON: &str = r#"[
        {
            "qualifying_total": 285,
            "event_name": "Nationals",
            "gender": "Men",
            "age_category": "Senior",
            "weight_class": "81kg"
        }
    ]"#;

    #[test]
    fn parse_backend_response() {
        let totals: Vec<QualifyingTotal> = serde_json::from_str(JSON).unwrap();

        let row = &totals[0];
        assert_eq!(row.qualifying_total, 285.0);
        assert_eq!(row.event_name, "Nationals");
        assert_eq!(row.gender, "Men");
        assert_eq!(row.age_category, "Senior");
        assert_eq!(row.weight_class, "81kg");
    }

    #[test]
    fn rejects_missing_field() {
        let bad_json = r#"[{ "qualifying_total": 285, "gender": "Men" }]"#;
        let result: Result<Vec<QualifyingTotal>, _> = serde_json::from_str(bad_json);
        assert!(result.is_err());
    }
}
