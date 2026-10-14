use anyhow::Result;
use clap::Parser;
use comfy_table::Table;

use crate::types::lifting_results::AdaptiveRecord;
use crate::utils::backend::{queries, query};
use crate::utils::output::{self, Report};
use serde_json::json;

/// Search for Adaptive American Records for a gender.
#[derive(Parser)]
#[command(
    name = "adaptive-records",
    after_help = r#"Examples:
  meetcal adaptive-records Women"#
)]
pub struct AdaptiveArgs {
    /// Gender: Men or Women
    pub gender: String,
}

pub async fn run(args: AdaptiveArgs) -> Result<()> {
    let gender = args.gender;

    let query_args = json!({ "excludeFederation": "BWL", "gender": gender });
    let records: Vec<AdaptiveRecord> = query(queries::ADAPTIVE_RECORDS, &query_args).await?;

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

    output::emit(Report::single("adaptive_records", table));

    Ok(())
}
