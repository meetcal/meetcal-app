use crate::types::records::Record;
use crate::utils::backend::{NoArgs, queries, query};
use crate::utils::filters::{
    Filter, is_gender, no_match, same_ignoring_case_and_surrounding_space,
};
use crate::utils::format::{RecordRow, record_tables};
use crate::utils::output::{self, Report};
use crate::utils::sort::sort_by_class;
use crate::utils::stats::Gender;
use anyhow::Result;
use clap::Parser;

/// Search for Records for a given age, federation, and gender.
#[derive(Parser)]
#[command(
    name = "records",
    after_help = r#"Examples:
  meetcal records --age Senior --gender Men --federation USAW"#
)]
pub struct RecordsArgs {
    /// Age group: U13, U15, U17, U20, U23, Youth, Junior, University, Senior,
    /// Masters 30, Masters 35, Masters 40, Masters 45, Masters 50, Masters 55,
    /// Masters 60, Masters 65, Masters 70, Masters 75, Masters 80, Masters 85,
    /// or Masters 90
    #[arg(long, short = 'a')]
    pub age: String,

    /// Gender: Men or Women (m, f, male and female work too)
    #[arg(long, short = 'g', value_parser = crate::utils::filters::parse_gender)]
    pub gender: Gender,

    /// Federation: BWL, IWF, UMWF, USAMW, or USAW
    #[arg(long, short = 'f')]
    pub federation: String,
}

pub async fn run(args: RecordsArgs) -> Result<()> {
    let records: Vec<Record> = query(queries::RECORDS, &NoArgs {}).await?;
    let sorted = selected(records, &args.age, args.gender, &args.federation)?;

    output::emit(report(&sorted));

    Ok(())
}

pub(crate) fn report(records: &[Record]) -> Report {
    let (table, data) = record_tables(records.iter().map(|record| RecordRow {
        weight_class: &record.weight_class,
        snatch: (Some(record.snatch_record), record.snatch_by.as_ref()),
        cj: (Some(record.cj_record), record.cj_by.as_ref()),
        total: (Some(record.total_record), record.total_by.as_ref()),
    }));
    Report::new().table_with_data("records", table, data)
}

pub(crate) fn selected(
    records: Vec<Record>,
    age: &str,
    gender: Gender,
    federation: &str,
) -> Result<Vec<Record>> {
    let same = same_ignoring_case_and_surrounding_space;
    let (matching, others): (Vec<Record>, Vec<Record>) = records.into_iter().partition(|row| {
        same(&row.age_category, age)
            && is_gender(&row.gender, gender)
            && same(&row.record_type, federation)
    });
    if matching.is_empty() {
        let filters = [
            Filter {
                option: "--federation",
                value: federation,
            },
            Filter {
                option: "--gender",
                value: gender.label(),
            },
            Filter {
                option: "--age",
                value: age,
            },
        ];
        let rows: Vec<Vec<&str>> = others
            .iter()
            .map(|row| {
                vec![
                    row.record_type.as_str(),
                    row.gender.as_str(),
                    row.age_category.as_str(),
                ]
            })
            .collect();
        return Err(no_match("records", &filters, &rows));
    }
    Ok(sort_by_class(matching, |r| r.weight_class.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(federation: &str, gender: &str, age: &str, class: &str) -> Record {
        serde_json::from_value(serde_json::json!({
            "weight_class": class,
            "snatch_record": 100.0,
            "cj_record": 120.0,
            "total_record": 220.0,
            "gender": gender,
            "age_category": age,
            "record_type": federation,
        }))
        .unwrap()
    }

    fn records() -> Vec<Record> {
        vec![
            record("USAW", "Men", "Senior", "110+"),
            record("USAW", "Men", "Senior", "60"),
            record("USAW", "Women", "Senior", "48"),
            record("USAW", "Men", "Masters 35", "60"),
            record("IWF", "Men", "Senior", "60"),
        ]
    }

    #[test]
    fn filters_ignore_case_and_surrounding_space() {
        let classes = |age: &str, gender: Gender, federation: &str| -> Vec<String> {
            selected(records(), age, gender, federation)
                .unwrap()
                .into_iter()
                .map(|row| row.weight_class)
                .collect()
        };
        assert_eq!(classes("Senior", Gender::Men, "USAW"), ["60", "110+"]);
        assert_eq!(classes(" senior ", Gender::Men, " usaw"), ["60", "110+"]);
        assert_eq!(classes("Senior", Gender::Men, "USAW"), ["60", "110+"]);
        assert_eq!(classes("Senior", Gender::Women, "USAW"), ["48"]);
    }

    #[test]
    fn a_filter_that_matches_nothing_is_an_error_naming_the_values() {
        let error = |age: &str, gender: Gender, federation: &str| {
            selected(records(), age, gender, federation)
                .expect_err("matched nothing")
                .to_string()
        };
        assert_eq!(
            error("Seniors", Gender::Men, "USAW"),
            "No records for --age \"Seniors\" with --federation USAW --gender Men. Try one of: \
             Masters 35, Senior"
        );
        assert_eq!(
            error("Seniors", Gender::Men, "USAW"),
            "No records for --age \"Seniors\" with --federation USAW --gender Men. Try one of: \
             Masters 35, Senior"
        );
        assert_eq!(
            error("Senior", Gender::Men, "USAWW"),
            "No records for --federation \"USAWW\". Try one of: IWF, USAW"
        );
        assert_eq!(
            error("Masters 35", Gender::Women, "USAW"),
            "No records for --age \"Masters 35\" with --federation USAW --gender Women. Try one \
             of: Senior"
        );
    }
}
