use anyhow::{Result, bail};
use clap::Parser;

use crate::commands::group_wrapped::{
    calculate_group_stats, get_wso_results_since, render_group_comparison, split_comparison_years,
};
use crate::commands::wrapped::current_year;

/// Compare a WSO's current calendar year with the previous calendar year.
///
/// Examples:
///   meetcal wso-compare Carolina
#[derive(Parser)]
#[command(name = "wso-compare")]
pub struct WsoCompareArgs {
    /// Weightlifting State Organization
    pub wso: String,
}

pub async fn run(args: WsoCompareArgs) -> Result<()> {
    let current_year = current_year();
    let previous_year = current_year - 1;
    let cutoff = format!("{previous_year:04}-01-01");
    let (memberships, results) = get_wso_results_since(&args.wso, &cutoff).await?;

    if memberships.is_empty() {
        bail!("No meet registrations found for WSO \"{}\"", args.wso);
    }

    let (previous_results, current_results) =
        split_comparison_years(results, previous_year, current_year);
    if previous_results.is_empty() && current_results.is_empty() {
        bail!(
            "No results found for WSO \"{}\" in {previous_year} or {current_year}",
            args.wso
        );
    }

    let previous = calculate_group_stats(&previous_results);
    let current = calculate_group_stats(&current_results);
    println!(
        "{}",
        render_group_comparison(
            "WSO",
            &args.wso,
            previous_year,
            current_year,
            &previous,
            &current,
        )
    );
    Ok(())
}
