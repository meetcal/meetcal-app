use anyhow::Result;
use clap::Parser;
use comfy_table::Table;
use serde::Deserialize;

use crate::utils::api::get_api_response_with_query;

#[derive(Debug, Deserialize)]
pub struct NatRankingYear {
    pub name: String,
    pub date: String,
    pub total: f64,
}

/// Search for National Rankings for a given weight.
///
/// Examples:
///   meetcal nat-rankings "Junior Women's 77kg" --federation USAW --year 2026
#[derive(Parser)]
#[command(name = "nat-rankings-year")]
pub struct NatRankingsYearArgs {
    /// Weight class to search for
    pub weight_class: String,

    /// Federation: USAW or USAMW
    #[arg(long, short = 'f')]
    pub federation: String,

    #[arg(long, short = 'y')]
    pub year: String,
}

pub async fn run(args: NatRankingsYearArgs) -> Result<()> {
    // assign args to vars
    let class = args.weight_class;
    let federation = args.federation.to_ascii_uppercase();
    let year = args.year;

    let query_args = [
        ("age_category", class),
        ("federation", federation),
        ("year", year),
    ];
    let row_array: Vec<NatRankingYear> =
        get_api_response_with_query("/data/nat-rankings-year", &query_args).await?;

    // push to table
    let mut table = Table::new();
    table.set_header(vec!["Rank", "Name", "Total", "Meet Date"]);

    let mut rank = 1;

    for row in row_array {
        table.add_row(vec![
            rank.to_string(),
            row.name,
            row.total.to_string(),
            row.date,
        ]);
        rank += 1
    }

    println!("{table}");

    Ok(())
}
