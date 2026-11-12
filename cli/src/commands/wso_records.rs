use anyhow::{Result, bail};
use clap::Parser;

use crate::{
    types::wso::WSORecord,
    utils::{
        backend::{queries, query},
        format::{RecordRow, record_tables},
        names::{NameKind, not_found, wso_age_groups},
        output::{self, Report},
        sort::sort_by_class,
        stats::Gender,
    },
};

/// Search for WSO Records for a given age, wso, and gender.
#[derive(Parser)]
#[command(
    name = "wso-records",
    after_help = r#"Examples:
  meetcal wso-records --age Senior --gender Men --wso Carolina"#
)]
pub struct WsoRecordsArgs {
    /// Age group: U11, U13, U15, U17, Youth, Junior, Senior, Masters 35,
    /// Masters 40, Masters 45, Masters 50, Masters 55, Masters 60, Masters 65,
    /// Masters 70, Masters 75, Masters 80, Masters 85, or Masters 90
    #[arg(long, short = 'a')]
    pub age: String,

    /// Gender: Men or Women (m, f, male and female work too)
    #[arg(long, short = 'g', value_parser = crate::utils::filters::parse_gender)]
    pub gender: Gender,

    /// WSO, e.g. Carolina, California South or Florida (see `meetcal wsos`)
    #[arg(long, short = 'w', value_parser = crate::utils::filters::parse_name)]
    pub wso: String,
}

pub async fn run(args: WsoRecordsArgs) -> Result<()> {
    let age = args.age;
    let gender = args.gender.label();
    let wso = args.wso;

    let query_args = serde_json::json!({ "ageCategory": age, "gender": gender, "wso": wso });
    let records: Vec<WSORecord> = query(queries::WSO_RECORDS, &query_args).await?;
    if records.is_empty() {
        let groups = wso_age_groups(&wso).await?;
        if groups.is_empty() {
            let message = format!("No records found for WSO \"{wso}\"");
            return Err(not_found(NameKind::RecordWso, &wso, message).await);
        }
        bail!(
            "No {gender} {age} records for WSO \"{wso}\". Its age groups: {}",
            groups.join(", ")
        );
    }
    let sorted = sort_by_class(records, |r| r.weight_class.as_str());

    output::emit(report(&sorted));

    Ok(())
}

pub(crate) fn report(records: &[WSORecord]) -> Report {
    let (table, data) = record_tables(records.iter().map(|record| RecordRow {
        weight_class: &record.weight_class,
        snatch: (record.snatch_record, record.snatch_by.as_ref()),
        cj: (record.cj_record, record.cj_by.as_ref()),
        total: (record.total_record, record.total_by.as_ref()),
    }));
    Report::new().table_with_data("wso_records", table, data)
}
