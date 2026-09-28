use anyhow::Result;
use clap::Parser;
use comfy_table::Table;
use serde::Deserialize;

use crate::utils::api::get_api_response;

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

    let rankings: Vec<Rankings> = get_api_response("/data/intl-rankings").await?;

    // push to table
    let mut table = Table::new();
    table.set_header(vec!["Rank", "Name", "Class", "Percent A", "Total"]);

    for total in rankings.into_iter().filter(|row| {
        row.age_category.eq_ignore_ascii_case(&age)
            && row.gender.eq_ignore_ascii_case(&gender)
            && row.meet.eq_ignore_ascii_case(&meet)
    }) {
        table.add_row(vec![
            total.ranking.to_string(),
            total.name,
            total.weight_class,
            total.percent_a.to_string(),
            total.total.to_string(),
        ]);
    }

    println!("{table}");

    Ok(())
}
