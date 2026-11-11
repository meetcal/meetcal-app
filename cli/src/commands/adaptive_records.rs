use anyhow::Result;
use clap::Parser;
use comfy_table::Table;

use crate::types::lifting_results::AdaptiveRecord;
use crate::utils::backend::{queries, query};
use crate::utils::format::kg;
use crate::utils::output::{self, Report};
use crate::utils::stats::Gender;
use serde_json::json;

/// Search for Adaptive American Records for a gender.
#[derive(Parser)]
#[command(
    name = "adaptive-records",
    after_help = r#"Examples:
  meetcal adaptive-records Women"#
)]
pub struct AdaptiveArgs {
    /// Gender: Men or Women (m, f, male and female work too)
    #[arg(value_parser = crate::utils::filters::parse_gender)]
    pub gender: Gender,
}

pub async fn run(args: AdaptiveArgs) -> Result<()> {
    let query_args = json!({ "excludeFederation": "BWL", "gender": args.gender.label() });
    let records: Vec<AdaptiveRecord> = query(queries::ADAPTIVE_RECORDS, &query_args).await?;
    output::emit(report(&records));
    Ok(())
}

pub fn report(records: &[AdaptiveRecord]) -> Report {
    let header = vec!["Weight Class", "Snatch", "CJ", "Total"];
    let mut table = Table::new();
    table.set_header(header.clone());
    let mut unset_records_as_null = Table::new();
    unset_records_as_null.set_header(header);
    for record in records {
        table.add_row(vec![
            record.weight_class.to_string(),
            record.snatch.to_string(),
            record.cj.to_string(),
            record.total.to_string(),
        ]);
        unset_records_as_null.add_row(vec![
            record.weight_class.to_string(),
            kg(record.snatch),
            kg(record.cj),
            kg(record.total),
        ]);
    }
    Report::new().table_with_data("adaptive_records", table, unset_records_as_null)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_class_with_no_record_exports_null_and_still_shows_zero() {
        let records = vec![
            AdaptiveRecord {
                weight_class: "60kg".into(),
                snatch: 80.0,
                cj: 0.0,
                total: 0.0,
            },
        ];
        let report = report(&records);
        assert_eq!(
            report.to_json(),
            serde_json::json!([{ "weight_class": "60kg", "snatch": 80, "cj": null, "total": null }])
        );
        assert!(report.to_text().contains("| 0 "));
    }
}
