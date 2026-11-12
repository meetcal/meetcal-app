use anyhow::Result;
use clap::Parser;
use comfy_table::Table;
use serde::Deserialize;

use crate::utils::backend::{NoArgs, queries, query};
use crate::utils::filters::{
    Filter, gender_as_matched, is_gender, no_match, same_ignoring_case_and_surrounding_space,
};
use crate::utils::output::{self, Report};
use crate::utils::stats::Gender;

#[derive(Debug, Deserialize)]
pub struct QualifyingTotal {
    pub qualifying_total: f64,
    pub event_name: String,
    pub gender: String,
    pub age_category: String,
    pub weight_class: String,
}

/// Search for Qualifying Totals for a given age, gender, and event.
#[derive(Parser)]
#[command(
    name = "qualifying-totals",
    after_help = r#"Examples:
  meetcal qualifying-totals --age Junior --gender Men --event "2027 Nationals""#
)]
pub struct QualTotalsArgs {
    /// Age group: U11, U13, U15, U17, U23, U25, Junior, University, Senior,
    /// Masters 35, Masters 40, Masters 45, Masters 50, Masters 55, Masters 60,
    /// Masters 65, Masters 70, Masters 75, Masters 80, Masters 85, or Masters 90
    #[arg(long, short = 'a')]
    pub age: String,

    /// Gender: Men or Women (m, f, male and female work too)
    #[arg(long, short = 'g', value_parser = crate::utils::filters::parse_gender)]
    pub gender: Gender,

    /// Event to search for
    #[arg(long, short = 'e', value_parser = crate::utils::filters::parse_name)]
    pub event: String,
}

pub async fn run(args: QualTotalsArgs) -> Result<()> {
    let totals: Vec<QualifyingTotal> = query(queries::QUALIFYING_TOTALS, &NoArgs {}).await?;
    let matching = selected(totals, &args.age, args.gender, &args.event)?;

    let mut table = Table::new();
    table.set_header(vec!["Class", "Total"]);

    for total in matching {
        table.add_row(vec![total.weight_class, total.qualifying_total.to_string()]);
    }

    output::emit(Report::single("qualifying_totals", table));

    Ok(())
}

pub fn selected(
    totals: Vec<QualifyingTotal>,
    age: &str,
    gender: Gender,
    event: &str,
) -> Result<Vec<QualifyingTotal>> {
    let same = same_ignoring_case_and_surrounding_space;
    let (matching, others): (Vec<QualifyingTotal>, Vec<QualifyingTotal>) =
        totals.into_iter().partition(|row| {
            same(&row.age_category, age)
                && is_gender(&row.gender, gender)
                && same(&row.event_name, event)
        });
    if matching.is_empty() {
        let filters = [
            Filter {
                option: "--age",
                value: age,
            },
            Filter {
                option: "--gender",
                value: gender.label(),
            },
            Filter {
                option: "--event",
                value: event,
            },
        ];
        let rows: Vec<Vec<&str>> = others
            .iter()
            .map(|row| {
                vec![
                    row.age_category.as_str(),
                    gender_as_matched(&row.gender),
                    row.event_name.as_str(),
                ]
            })
            .collect();
        return Err(no_match("qualifying totals", &filters, &rows));
    }
    Ok(matching)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn total(age: &str, gender: &str, event: &str, class: &str) -> QualifyingTotal {
        QualifyingTotal {
            qualifying_total: 200.0,
            event_name: event.into(),
            gender: gender.into(),
            age_category: age.into(),
            weight_class: class.into(),
        }
    }

    fn totals() -> Vec<QualifyingTotal> {
        vec![
            total("Junior", "Men", "2027 Nationals", "60"),
            total("Junior", "Women", "2027 Nationals", "48"),
            total("Senior ", "Men", "2027 Finals", "65"),
        ]
    }

    #[test]
    fn totals_match_ignoring_case_and_space_for_either_gender() {
        let classes = |age: &str, gender: Gender, event: &str| -> Vec<String> {
            selected(totals(), age, gender, event)
                .unwrap()
                .into_iter()
                .map(|row| row.weight_class)
                .collect()
        };
        assert_eq!(classes(" junior", Gender::Men, "2027 nationals "), ["60"]);
        assert_eq!(classes("Junior", Gender::Women, "2027 Nationals"), ["48"]);
        assert_eq!(classes("Senior", Gender::Men, "2027 Finals"), ["65"]);
    }

    #[test]
    fn a_total_filter_that_matches_nothing_names_the_filter_at_fault() {
        let error = selected(totals(), "Junior", Gender::Men, "2027 Nationls")
            .expect_err("matched nothing")
            .to_string();
        assert_eq!(
            error,
            "No qualifying totals for --event \"2027 Nationls\" with --age Junior --gender Men. \
             Try one of: 2027 Nationals"
        );
    }

    const JSON: &str = r#"[
        {
            "qualifying_total": 285,
            "event_name": "Nationals",
            "gender": "Men",
            "age_category": "Senior",
            "weight_class": "81kg"
        }
    ]"#;

    #[test]
    fn parse_backend_response() {
        let totals: Vec<QualifyingTotal> = serde_json::from_str(JSON).unwrap();

        let row = &totals[0];
        assert_eq!(row.qualifying_total, 285.0);
        assert_eq!(row.event_name, "Nationals");
        assert_eq!(row.gender, "Men");
        assert_eq!(row.age_category, "Senior");
        assert_eq!(row.weight_class, "81kg");
    }

    #[test]
    fn rejects_missing_field() {
        let bad_json = r#"[{ "qualifying_total": 285, "gender": "Men" }]"#;
        let result: Result<Vec<QualifyingTotal>, _> = serde_json::from_str(bad_json);
        assert!(result.is_err());
    }
}
