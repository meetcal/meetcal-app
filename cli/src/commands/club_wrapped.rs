use anyhow::Result;
use clap::Parser;

use crate::commands::group_wrapped::{Group, run_wrapped};
use crate::commands::wrapped::current_year;

/// Show a club's calendar year in lifting.
#[derive(Parser)]
#[command(
    name = "club-wrapped",
    after_help = r#"Examples:
  meetcal club-wrapped "Columbus Weightlifting"
  meetcal club-wrapped "Columbus Weightlifting" --year 2025"#
)]
pub struct ClubWrappedArgs {
    pub club: String,

    /// Calendar year to summarize (defaults to the current year)
    #[arg(long, short = 'y', value_parser = clap::value_parser!(i32).range(1900..=9999))]
    pub year: Option<i32>,
}

pub async fn run(args: ClubWrappedArgs) -> Result<()> {
    run_wrapped(
        Group::Club(&args.club),
        args.year.unwrap_or_else(current_year),
    )
    .await
}
