use anyhow::Result;
use clap::Parser;

use crate::commands::group_wrapped::{Group, run_compare};
use crate::commands::wrapped::current_year;

/// Compare a club's current calendar year with the previous calendar year.
#[derive(Parser)]
#[command(
    name = "club-compare",
    after_help = r#"Examples:
  meetcal club-compare "POWER AND GRACE PERFORMANCE.""#
)]
pub struct ClubCompareArgs {
    #[arg(value_parser = crate::utils::filters::parse_name)]
    pub club: String,
}

pub async fn run(args: ClubCompareArgs) -> Result<()> {
    run_compare(Group::Club(&args.club), current_year()).await
}
