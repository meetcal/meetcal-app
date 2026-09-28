use anyhow::{Result, bail};
use clap::Parser;
use comfy_table::Table;

use crate::{
    types::wso::WSORecord,
    utils::{
        backend::{queries, query},
        format::{record_cell, record_data_cells, record_data_header},
        names::{NameKind, not_found, wso_age_groups},
        output::{self, Report},
        sort::sort_by_class,
    },
};

/// Search for WSO Records for a given age, wso, and gender.
///
/// Examples:
///   meetcal wso-records --age Senior --gender Men --wso Carolinas
#[derive(Parser)]
#[command(name = "wso-records")]
pub struct WsoRecordsArgs {
    /// Age group: U11, U13, U15, U17, Youth, Junior, Senior, Masters 35,
    /// Masters 40, Masters 45, Masters 50, Masters 55, Masters 60, Masters 65,
    /// Masters 70, Masters 75, Masters 80, Masters 85, or Masters 90
    #[arg(long, short = 'a')]
    pub age: String,

    /// Gender: Men or Women
    #[arg(long, short = 'g')]
    pub gender: String,

    /// WSO region to search for
    /// Carolina, California South, Florida, etc
    #[arg(long, short = 'w')]
    pub wso: String,
}

pub async fn run(args: WsoRecordsArgs) -> Result<()> {
    let age = args.age;
    let gender = args.gender;
    let wso = args.wso;

    let query_args = serde_json::json!({ "ageCategory": age, "gender": gender, "wso": wso });
    let records: Vec<WSORecord> = query(queries::WSO_RECORDS, &query_args).await?;
    if records.is_empty() {
        let groups = wso_age_groups(&wso).await.unwrap_or_default();
        if groups.is_empty() {
            let message = format!("No records found for WSO \"{wso}\"");
            return Err(not_found(NameKind::Wso, &wso, message).await);
        }
        bail!(
            "No {gender} {age} records for WSO \"{wso}\". Its age groups: {}",
            groups.join(", ")
        );
    }
    let sorted = sort_by_class(records, |r| r.weight_class.as_str());

    let mut table = Table::new();
    table.set_header(vec!["Class", "Snatch", "CJ", "Total"]);
    let mut data = Table::new();
    data.set_header(record_data_header());

    for record in sorted {
        let lifts = [
            (record.snatch_record, record.snatch_by.as_ref()),
            (record.cj_record, record.cj_by.as_ref()),
            (record.total_record, record.total_by.as_ref()),
        ];
        let mut row = vec![record.weight_class.clone()];
        row.extend(
            lifts
                .iter()
                .map(|(value, holder)| record_cell(*value, *holder)),
        );
        table.add_row(row);
        let mut data_row = vec![record.weight_class.clone()];
        for (value, holder) in lifts {
            data_row.extend(record_data_cells(value, holder));
        }
        data.add_row(data_row);
    }

    output::emit(Report::new().table_with_data("wso_records", table, data));

    Ok(())
}
