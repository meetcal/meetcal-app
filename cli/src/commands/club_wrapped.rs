use anyhow::{Result, bail};
use clap::Parser;

use crate::commands::group_wrapped::{
    calculate_group_stats, get_club_results_since, render_group_wrapped, results_for_year,
};
use crate::commands::wrapped::current_year;

/// Show a club's calendar year in lifting.
///
/// Examples:
///   meetcal club-wrapped "Columbus Weightlifting"
///   meetcal club-wrapped "Columbus Weightlifting" --year 2025
#[derive(Parser)]
#[command(name = "club-wrapped")]
pub struct ClubWrappedArgs {
    pub club: String,

    /// Calendar year to summarize (defaults to the current year)
    #[arg(long, short = 'y', value_parser = clap::value_parser!(i32).range(1900..=9999))]
    pub year: Option<i32>,
}

pub async fn run(args: ClubWrappedArgs) -> Result<()> {
    let year = args.year.unwrap_or_else(current_year);
    let cutoff = format!("{year:04}-01-01");
    let (memberships, results) = get_club_results_since(&args.club, &cutoff).await?;

    if memberships.is_empty() {
        bail!(
            "No completed-meet athletes found for club \"{}\"",
            args.club
        );
    }

    let results = results_for_year(results, year);
    if results.is_empty() {
        bail!("No results found for club \"{}\" in {year}", args.club);
    }

    let stats = calculate_group_stats(&results);
    println!("{}", render_group_wrapped("Club", &args.club, year, &stats));
    Ok(())
}
