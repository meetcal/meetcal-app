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
#[derive(Parser)]
#[command(
    name = "intl-rankings",
    after_help = r#"Examples:
  meetcal intl-rankings --age Senior --gender Men --meet Worlds"#
)]
pub struct IntlRankingsArgs {
    /// Age group: U15, U17, Youth, Junior, University, or Senior
    #[arg(long, short = 'a')]
    pub age: String,

    /// Gender: Men or Women (m, f, male and female work too)
    #[arg(long, short = 'g', value_parser = crate::utils::filters::parse_gender)]
    pub gender: Gender,

    /// Meet to search for
    #[arg(long, short = 'm', value_parser = crate::utils::filters::parse_name)]
    pub meet: String,
}

pub async fn run(args: IntlRankingsArgs) -> Result<()> {
    let rankings: Vec<Rankings> = query(queries::INTL_RANKINGS, &NoArgs {}).await?;
    let matching = selected(rankings, &args.age, args.gender, &args.meet)?;

    let mut table = Table::new();
    table.set_header(vec!["Rank", "Name", "Class", "Percent A", "Total"]);

    for total in best_first(matching) {
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

pub fn selected(
    rankings: Vec<Rankings>,
    age: &str,
    gender: Gender,
    meet: &str,
) -> Result<Vec<Rankings>> {
    let same = same_ignoring_case_and_surrounding_space;
    let (matching, others): (Vec<Rankings>, Vec<Rankings>) =
        rankings.into_iter().partition(|row| {
            same(&row.age_category, age) && is_gender(&row.gender, gender) && same(&row.meet, meet)
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
                option: "--meet",
                value: meet,
            },
        ];
        let rows: Vec<Vec<&str>> = others
            .iter()
            .map(|row| {
                vec![
                    row.age_category.as_str(),
                    gender_as_matched(&row.gender),
                    row.meet.as_str(),
                ]
            })
            .collect();
        return Err(no_match("international rankings", &filters, &rows));
    }
    Ok(matching)
}

pub fn best_first(mut rows: Vec<Rankings>) -> Vec<Rankings> {
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
        let rows = best_first(vec![
            ranked(10.0, "Ten"),
            ranked(9.0, "Nine"),
            ranked(1.0, "One"),
        ]);
        let names: Vec<&str> = rows.iter().map(|row| row.name.as_str()).collect();
        assert_eq!(names, ["One", "Nine", "Ten"]);
    }

    #[test]
    fn rankings_match_ignoring_case_and_space_and_a_miss_names_the_filter_at_fault() {
        let rankings = || vec![ranked(1.0, "One"), ranked(2.0, "Two")];
        let matched = selected(rankings(), " senior", Gender::Men, "worlds ").unwrap();
        assert_eq!(matched.len(), 2);
        let error = selected(rankings(), "Senior", Gender::Women, "Worlds")
            .expect_err("matched nothing")
            .to_string();
        assert_eq!(
            error,
            "No international rankings for --gender \"Women\" with --age Senior. Try one of: Men"
        );
        let error = selected(rankings(), "Senior", Gender::Men, "World")
            .expect_err("matched nothing")
            .to_string();
        assert_eq!(
            error,
            "No international rankings for --meet \"World\" with --age Senior --gender Men. Try \
             one of: Worlds"
        );
    }
}
