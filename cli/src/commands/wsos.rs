use anyhow::Result;
use clap::Parser;

use crate::utils::names::{NameKind, not_found, wso_age_groups, wsos};
use crate::utils::output::{self, Report};

/// List WSOs, or the age groups one keeps records for (the values `wso-records --age` takes).
///
/// Examples:
///   meetcal wsos
///   meetcal wsos Carolina
#[derive(Parser)]
#[command(name = "wsos")]
pub struct WsosArgs {
    /// A WSO whose record age groups to list
    pub wso: Option<String>,
}

pub async fn run(args: WsosArgs) -> Result<()> {
    let Some(wso) = args.wso else {
        output::emit(Report::single("wsos", output::list("WSO", wsos().await?)));
        return Ok(());
    };

    let groups = wso_age_groups(&wso).await?;
    if groups.is_empty() {
        let message = format!("No records found for WSO \"{wso}\"");
        return Err(not_found(NameKind::Wso, &wso, message).await);
    }
    output::emit(Report::single(
        "age_groups",
        output::list("Age Group", groups),
    ));
    Ok(())
}
