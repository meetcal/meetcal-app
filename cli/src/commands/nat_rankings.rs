use anyhow::Result;
use clap::Parser;
use comfy_table::Table;
use serde::Deserialize;

use crate::utils::api::get_api_response_with_query;

#[derive(Debug, Deserialize)]
pub struct NatRanking {
    pub name: String,
    pub total: f64,
}

/// Search for National Rankings for a given weight.
///
/// Examples:
///   meetcal nat-rankings "Junior Women's 77kg"
#[derive(Parser)]
#[command(name = "nat-rankings")]
pub struct NatRankingsArgs {
    /// Weight class to search for
    pub weight_class: String,

    /// Federation: USAW or USAMW
    #[arg(long, short = 'f')]
    pub federation: String,
}

pub async fn run(args: NatRankingsArgs) -> Result<()> {
    // assign args to vars
    let class = args.weight_class;
    let federation = args.federation.to_ascii_uppercase();

    let query_args = [("age_category", class), ("federation", federation)];
    let row_array: Vec<NatRanking> =
        get_api_response_with_query("/data/nat-rankings", &query_args).await?;

    // push to table
    let mut table = Table::new();
    table.set_header(vec!["Rank", "Name", "Total"]);

    let mut rank = 1;

    for row in row_array {
        table.add_row(vec![rank.to_string(), row.name, row.total.to_string()]);
        rank += 1
    }

    println!("{table}");

    Ok(())
}

#[cfg(test)]
mod test {
    use super::*;

    const JSON: &str = r#"[
        {
            "name": "Maddisen",
            "total": 140
        },
        {
            "name": "Nikki",
            "total": 130
        }
    ]"#;

    #[test]
    fn parse_backend_response() {
        let rows: Vec<NatRanking> = serde_json::from_str(JSON).unwrap();

        assert_eq!(rows.len(), 2);

        let row = &rows[0];
        assert_eq!(row.name, "Maddisen");
        assert_eq!(row.total, 140.0);
    }

    #[test]
    fn sorting() {
        let mut rows: Vec<NatRanking> = serde_json::from_str(JSON).unwrap();
        rows.sort_by(|a, b| b.total.total_cmp(&a.total));

        assert_eq!(rows[0].name, "Maddisen");
        assert_eq!(rows[0].total, 140.0);
        assert_eq!(rows[1].name, "Nikki");
        assert_eq!(rows[1].total, 130.0);
    }

    #[test]
    fn rejects_missing_field() {
        let bad_json = r#"[
            {
                "name": "Maddisen"
            }
        ]"#;

        let result: Result<Vec<NatRanking>, _> = serde_json::from_str(bad_json);
        assert!(result.is_err());
    }
}
