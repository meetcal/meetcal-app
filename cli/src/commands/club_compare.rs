use anyhow::{Result, bail};
use clap::Parser;

use crate::commands::group_wrapped::{
    calculate_group_stats, get_club_results_since, render_group_comparison, split_comparison_years,
};
use crate::commands::wrapped::current_year;

/// Compare a club's current calendar year with the previous calendar year.
///
/// Examples:
///   meetcal club-compare "POWER AND GRACE PERFORMANCE."
#[derive(Parser)]
#[command(name = "club-compare")]
pub struct ClubCompareArgs {
    pub club: String,
}

pub async fn run(args: ClubCompareArgs) -> Result<()> {
    let current_year = current_year();
    let previous_year = current_year - 1;
    let cutoff = format!("{previous_year:04}-01-01");
    let (memberships, results) = get_club_results_since(&args.club, &cutoff).await?;

    if memberships.is_empty() {
        bail!(
            "No completed-meet athletes found for club \"{}\"",
            args.club
        );
    }

    let (previous_results, current_results) =
        split_comparison_years(results, previous_year, current_year);
    if previous_results.is_empty() && current_results.is_empty() {
        bail!(
            "No results found for club \"{}\" in {previous_year} or {current_year}",
            args.club
        );
    }

    let previous = calculate_group_stats(&previous_results);
    let current = calculate_group_stats(&current_results);
    println!(
        "{}",
        render_group_comparison(
            "Club",
            &args.club,
            previous_year,
            current_year,
            &previous,
            &current,
        )
    );
    Ok(())
}
