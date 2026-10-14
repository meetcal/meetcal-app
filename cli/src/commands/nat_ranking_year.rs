use anyhow::Result;
use clap::Parser;
use comfy_table::Table;
use serde::Deserialize;

use crate::utils::backend::{queries, query};
use crate::utils::output::{self, Report};
use serde_json::json;

#[derive(Debug, Deserialize)]
pub struct NatRankingYear {
    pub name: String,
    pub date: String,
    pub total: f64,
}

/// Show a division's national rankings within one calendar year, with the date of each best.
#[derive(Parser)]
#[command(after_help = r#"Examples:
  meetcal nat-ranking-year "Junior Women's 77kg" --federation USAW --year 2025"#)]
pub struct NatRankingsYearArgs {
    /// Division to rank, e.g. "Junior Women's 77kg" or "Open Men's 89kg"
    pub weight_class: String,

    /// Federation: USAW or USAMW
    #[arg(long, short = 'f')]
    pub federation: String,

    /// Calendar year to rank, e.g. 2025
    #[arg(long, short = 'y', value_parser = clap::value_parser!(i32).range(1900..=9999))]
    pub year: i32,
}

pub async fn run(args: NatRankingsYearArgs) -> Result<()> {
    // assign args to vars
    let class = args.weight_class;
    let federation = args.federation.to_ascii_uppercase();
    let year = args.year.to_string();

    let query_args = json!({ "ageCategory": class, "federation": federation, "year": year });
    let row_array: Vec<NatRankingYear> =
        query(queries::NATIONAL_RANKINGS_BY_YEAR, &query_args).await?;

    // push to table
    let mut table = Table::new();
    table.set_header(vec!["Rank", "Name", "Total", "Meet Date"]);

    for (rank, row) in (1..).zip(row_array) {
        table.add_row(vec![
            rank.to_string(),
            row.name,
            row.total.to_string(),
            row.date,
        ]);
    }

    output::emit(Report::single("national_rankings", table));

    Ok(())
}
