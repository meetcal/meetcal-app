use anyhow::Result;
use clap::Parser;
use comfy_table::Table;

use crate::{
    types::lifting_results::LiftingResults,
    utils::{api::get_api_response_with_query, make_rate::print_make_rate},
};

/// Search for results from a meet, returns all athletes' results and event stats.
///
/// Examples:
///   meetcal meet-results "2026 AZ Summer Slam Nationals Qualifier"
#[derive(Parser)]
#[command(name = "meet-results")]
pub struct MeetResultsArgs {
    /// Meet to search for
    pub name: String,
}

pub async fn run(args: MeetResultsArgs) -> Result<()> {
    let name = args.name;

    let query_args = [("meet", name)];
    let mut results: Vec<LiftingResults> =
        get_api_response_with_query("/lifting-results", &query_args).await?;

    results.sort_by(|a, b| b.total.total_cmp(&a.total));

    let mut meet_table = Table::new();

    meet_table.set_header(vec![
        "Name", "Class", "BW", "Adaptive", "Sn1", "Sn2", "Sn3", "CJ1", "CJ2", "CJ3", "Total",
    ]);

    for result in &results {
        meet_table.add_row(vec![
            result.name.to_string(),
            result.age.to_string(),
            result.body_weight.to_string(),
            result.adaptive.to_string(),
            result.snatch1.to_string(),
            result.snatch2.to_string(),
            result.snatch3.to_string(),
            result.cj1.to_string(),
            result.cj2.to_string(),
            result.cj3.to_string(),
            result.total.to_string(),
        ]);
    }

    println!("{meet_table}");

    print_make_rate(&results);

    Ok(())
}
