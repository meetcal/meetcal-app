use anyhow::Result;
use clap::Parser;

use crate::utils::names::{NameKind, not_found, wso_age_groups, wsos};

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
        println!("{}", wsos().await?.join("\n"));
        return Ok(());
    };

    let groups = wso_age_groups(&wso).await?;
    if groups.is_empty() {
        let message = format!("No records found for WSO \"{wso}\"");
        return Err(not_found(NameKind::Wso, &wso, message).await);
    }
    println!("{}", groups.join("\n"));
    Ok(())
}
