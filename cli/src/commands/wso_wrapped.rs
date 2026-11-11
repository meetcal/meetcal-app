use anyhow::Result;
use clap::Parser;

use crate::commands::group_wrapped::{Group, run_wrapped};
use crate::commands::wrapped::current_year;

/// Show a WSO's calendar year in lifting.
#[derive(Parser)]
#[command(
    name = "wso-wrapped",
    after_help = r#"Examples:
  meetcal wso-wrapped Carolina
  meetcal wso-wrapped Carolina --year 2026"#
)]
pub struct WsoWrappedArgs {
    /// Weightlifting State Organization
    #[arg(value_parser = crate::utils::filters::parse_name)]
    pub wso: String,

    /// Calendar year to summarize (defaults to the current year)
    #[arg(long, short = 'y', value_parser = clap::value_parser!(i32).range(1900..=9999))]
    pub year: Option<i32>,
}

pub async fn run(args: WsoWrappedArgs) -> Result<()> {
    run_wrapped(
        Group::Wso(&args.wso),
        args.year.unwrap_or_else(current_year),
    )
    .await
}
