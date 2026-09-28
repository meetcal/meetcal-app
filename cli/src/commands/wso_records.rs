use anyhow::Result;
use clap::Parser;
use comfy_table::Table;

use crate::{
    types::wso::WSORecord,
    utils::{api::get_api_response_with_query, sort::sort_by_class},
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

    let query_args = [("age_category", age), ("gender", gender), ("wso", wso)];
    let records: Vec<WSORecord> =
        get_api_response_with_query("/data/wso/records", &query_args).await?;
    let sorted = sort_by_class(records, |r| r.weight_class.as_str());

    let mut table = Table::new();
    table.set_header(vec!["Class", "Snatch", "CJ", "Total"]);

    for record in sorted {
        table.add_row(vec![
            record.weight_class.to_string(),
            record
                .snatch_record
                .map(|value| value.to_string())
                .unwrap_or_default(),
            record
                .cj_record
                .map(|value| value.to_string())
                .unwrap_or_default(),
            record
                .total_record
                .map(|value| value.to_string())
                .unwrap_or_default(),
        ]);
    }

    println!("{table}");

    Ok(())
}
