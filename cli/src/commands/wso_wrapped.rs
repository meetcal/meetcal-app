use anyhow::{Result, bail};
use clap::Parser;

use crate::commands::group_wrapped::{
    calculate_group_stats, get_wso_results_since, render_group_wrapped, results_for_year,
};
use crate::commands::wrapped::current_year;

/// Show a WSO's calendar year in lifting.
///
/// Examples:
///   meetcal wso-wrapped Carolina
///   meetcal wso-wrapped Carolina --year 2025
#[derive(Parser)]
#[command(name = "wso-wrapped")]
pub struct WsoWrappedArgs {
    /// Weightlifting State Organization
    pub wso: String,

    /// Calendar year to summarize (defaults to the current year)
    #[arg(long, short = 'y', value_parser = clap::value_parser!(i32).range(1900..=9999))]
    pub year: Option<i32>,
}

pub async fn run(args: WsoWrappedArgs) -> Result<()> {
    let year = args.year.unwrap_or_else(current_year);
    let cutoff = format!("{year:04}-01-01");
    let (memberships, results) = get_wso_results_since(&args.wso, &cutoff).await?;

    if memberships.is_empty() {
        bail!("No meet registrations found for WSO \"{}\"", args.wso);
    }

    let results = results_for_year(results, year);
    if results.is_empty() {
        bail!("No results found for WSO \"{}\" in {year}", args.wso);
    }

    let stats = calculate_group_stats(&results);
    println!("{}", render_group_wrapped("WSO", &args.wso, year, &stats));
    Ok(())
}
