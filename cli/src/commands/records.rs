use crate::utils::sort::sort_by_class;
use crate::{types::records::Record, utils::api::get_api_response};
use anyhow::Result;
use clap::Parser;
use comfy_table::Table;

/// Search for Records for a given age, federation, and gender.
///
/// Examples:
///   meetcal records --age Senior --gender Men --federation USAW
#[derive(Parser)]
#[command(name = "records")]
pub struct RecordsArgs {
    /// Age group: U13, U15, U17, U20, U23, Youth, Junior, University, Senior,
    /// Masters 30, Masters 35, Masters 40, Masters 45, Masters 50, Masters 55,
    /// Masters 60, Masters 65, Masters 70, Masters 75, Masters 80, Masters 85,
    /// or Masters 90
    #[arg(long, short = 'a')]
    pub age: String,

    /// Gender: Men or Women
    #[arg(long, short = 'g')]
    pub gender: String,

    /// Federation: BWL, IWF, UMWF, USAMW, or USAW
    #[arg(long, short = 'f')]
    pub federation: String,
}

pub async fn run(args: RecordsArgs) -> Result<()> {
    let age = args.age;
    let gender = args.gender;
    let federation = args.federation.to_ascii_uppercase();

    let records: Vec<Record> = get_api_response("/data/records").await?;
    let filtered = records.into_iter().filter(|row| {
        row.age_category.eq_ignore_ascii_case(&age)
            && row.gender.eq_ignore_ascii_case(&gender)
            && row.record_type.eq_ignore_ascii_case(&federation)
    });
    let sorted = sort_by_class(filtered.collect(), |r| r.weight_class.as_str());

    let mut table = Table::new();
    table.set_header(vec!["Class", "Snatch", "CJ", "Total"]);

    for record in sorted {
        table.add_row(vec![
            record.weight_class,
            record.snatch_record.to_string(),
            record.cj_record.to_string(),
            record.total_record.to_string(),
        ]);
    }

    println!("{table}");

    Ok(())
}
