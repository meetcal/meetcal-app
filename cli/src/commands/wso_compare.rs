use anyhow::Result;
use clap::Parser;

use crate::commands::group_wrapped::{Group, run_compare};
use crate::commands::wrapped::current_year;

/// Compare a WSO's current calendar year with the previous calendar year.
#[derive(Parser)]
#[command(
    name = "wso-compare",
    after_help = r#"Examples:
  meetcal wso-compare Carolina"#
)]
pub struct WsoCompareArgs {
    /// Weightlifting State Organization
    pub wso: String,
}

pub async fn run(args: WsoCompareArgs) -> Result<()> {
    run_compare(Group::Wso(&args.wso), current_year()).await
}
