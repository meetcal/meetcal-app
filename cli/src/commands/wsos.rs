use anyhow::Result;
use clap::Parser;
use comfy_table::Table;

use crate::utils::names::{NameKind, not_found, registration_wsos, wso_age_groups, wsos};
use crate::utils::output::{self, Report};

/// List WSOs, or the age groups one keeps records for (the values `wso-records --age` takes).
#[derive(Parser)]
#[command(
    name = "wsos",
    after_help = r#"Examples:
  meetcal wsos
  meetcal wsos Carolina"#
)]
pub struct WsosArgs {
    /// A WSO whose record age groups to list
    pub wso: Option<String>,
}

pub async fn run(args: WsosArgs) -> Result<()> {
    let Some(wso) = args.wso else {
        let records = wsos().await?;
        let registrations = registration_wsos().await?;
        output::emit(Report::single("wsos", table(&registrations, &records)));
        return Ok(());
    };

    let groups = wso_age_groups(&wso).await?;
    if groups.is_empty() {
        let message = format!("No records found for WSO \"{wso}\"");
        return Err(not_found(NameKind::RecordWso, &wso, message).await);
    }
    output::emit(Report::single(
        "age_groups",
        output::list("Age Group", groups),
    ));
    Ok(())
}

/// Every WSO name, as registrations name it (what `wso-wrapped`, `wso-compare`, `wso-trends`,
/// `wso` and `leaderboard --wso` take) and as record sheets do (what `wso-records` takes). The
/// two differ: "California North Central" registers athletes, "California North" keeps records.
pub fn table(registrations: &[String], records: &[String]) -> Table {
    let mut names: Vec<&String> = records.iter().chain(registrations).collect();
    names.sort_by_key(|name| name.to_lowercase());
    names.dedup();
    let mut table = Table::new();
    table.set_header(vec!["WSO", "Registrations", "Records"]);
    for name in names {
        table.add_row(vec![
            name.clone(),
            registrations.contains(name).to_string(),
            records.contains(name).to_string(),
        ]);
    }
    table
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::output::Report;
    use serde_json::json;

    fn names(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn lists_registration_and_record_names_side_by_side() {
        let registrations = names(&["California North Central", "Florida", "Mountain North"]);
        let records = names(&["California North", "Florida"]);
        let json = Report::single("wsos", table(&registrations, &records)).to_json();
        assert_eq!(
            json,
            json!([
                { "wso": "California North", "registrations": false, "records": true },
                { "wso": "California North Central", "registrations": true, "records": false },
                { "wso": "Florida", "registrations": true, "records": true },
                { "wso": "Mountain North", "registrations": true, "records": false },
            ])
        );
    }
}
