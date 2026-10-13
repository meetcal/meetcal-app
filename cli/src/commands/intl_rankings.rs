use anyhow::Result;
use clap::Parser;
use comfy_table::Table;
use serde::Deserialize;

use crate::utils::backend::{NoArgs, queries, query};
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

    // push to table
    let mut table = Table::new();
    table.set_header(vec!["Rank", "Name", "Class", "Percent A", "Total"]);

    for total in selected(rankings, &age, &gender, &meet) {
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

/// The rankings for one age category, gender and meet, best (rank 1) first. The server answers
/// the highest rank number first.
pub fn selected(rankings: Vec<Rankings>, age: &str, gender: &str, meet: &str) -> Vec<Rankings> {
    let mut rows: Vec<Rankings> = rankings
        .into_iter()
        .filter(|row| {
            row.age_category.eq_ignore_ascii_case(age)
                && row.gender.eq_ignore_ascii_case(gender)
                && row.meet.eq_ignore_ascii_case(meet)
        })
        .collect();
    rows.sort_by(|a, b| a.ranking.total_cmp(&b.ranking));
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ranked(ranking: f64, name: &str) -> Rankings {
        Rankings {
            ranking,
            name: name.into(),
            weight_class: "88".into(),
            percent_a: 95.0,
            total: 349.0,
            meet: "Worlds".into(),
            gender: "Men".into(),
            age_category: "Senior".into(),
        }
    }

    #[test]
    fn rank_one_comes_first() {
        let rows = selected(
            vec![ranked(10.0, "Ten"), ranked(9.0, "Nine"), ranked(1.0, "One")],
            "senior",
            "men",
            "worlds",
        );
        let names: Vec<&str> = rows.iter().map(|row| row.name.as_str()).collect();
        assert_eq!(names, ["One", "Nine", "Ten"]);
    }
}
