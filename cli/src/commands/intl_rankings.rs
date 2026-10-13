use anyhow::Result;
use clap::Parser;
use comfy_table::Table;
use serde::Deserialize;

use crate::utils::backend::{NoArgs, queries, query};
use crate::utils::filters::{Filter, no_match};
use crate::utils::output::{self, Report};

#[derive(Debug, Deserialize)]
pub struct Rankings {
    pub ranking: f64,
    pub name: String,
    pub weight_class: String,
    pub percent_a: f64,
    pub total: f64,
    pub meet: String,
    pub gender: String,
    pub age_category: String,
}

/// Search for International Rankings for a given age, meet, and gender.
///
/// Examples:
///   meetcal intl-rankings --age Senior --gender Men --meet Worlds
#[derive(Parser)]
#[command(name = "intl-rankings")]
pub struct IntlRankingsArgs {
    /// Age group: U15, U17, Youth, Junior, University, or Senior
    #[arg(long, short = 'a')]
    pub age: String,

    /// Gender: Men or Women
    #[arg(long, short = 'g')]
    pub gender: String,

    /// Meet to search for
    #[arg(long, short = 'm')]
    pub meet: String,
}

pub async fn run(args: IntlRankingsArgs) -> Result<()> {
    // assign args to vars
    let age = args.age;
    let gender = args.gender;
    let meet = args.meet;

    let rankings: Vec<Rankings> = query(queries::INTL_RANKINGS, &NoArgs {}).await?;

    let (matching, others): (Vec<Rankings>, Vec<Rankings>) =
        rankings.into_iter().partition(|row| {
            row.age_category.eq_ignore_ascii_case(age.trim())
                && row.gender.eq_ignore_ascii_case(gender.trim())
                && row.meet.eq_ignore_ascii_case(meet.trim())
        });
    if matching.is_empty() {
        let filters = [
            Filter {
                option: "--age",
                value: &age,
            },
            Filter {
                option: "--gender",
                value: &gender,
            },
            Filter {
                option: "--meet",
                value: &meet,
            },
        ];
        let rows: Vec<Vec<&str>> = others
            .iter()
            .map(|row| {
                vec![
                    row.age_category.as_str(),
                    row.gender.as_str(),
                    row.meet.as_str(),
                ]
            })
            .collect();
        return Err(no_match("international rankings", &filters, &rows));
    }

    // push to table
    let mut table = Table::new();
    table.set_header(vec!["Rank", "Name", "Class", "Percent A", "Total"]);

    for total in matching {
        table.add_row(vec![
            total.ranking.to_string(),
            total.name,
            total.weight_class,
            total.percent_a.to_string(),
            total.total.to_string(),
        ]);
    }

    output::emit(Report::single("intl_rankings", table));

    Ok(())
}
