use anyhow::Result;
use clap::Parser;
use comfy_table::Table;
use serde_json::json;

use crate::types::meets::Meet;
use crate::utils::backend::{queries, query};
use crate::utils::format::date_range;
use crate::utils::names::{NameKind, not_found};
use crate::utils::output::{self, Report};

/// Show a meet's details: dates, status, venue and address, time zone, and venue maps.
///
/// Examples:
///   meetcal meet-info "2026 Florida State Championships (WSO Championships)"
#[derive(Parser)]
#[command(name = "meet-info")]
pub struct MeetInfoArgs {
    /// Exact meet name (see `meetcal meets`)
    pub name: String,
}

pub async fn run(args: MeetInfoArgs) -> Result<()> {
    let meet: Meet = match query(queries::MEET_DETAILS, &json!({ "meet": args.name })).await {
        Ok(meet) => meet,
        Err(error) if error.to_string().contains("meet not found") => {
            let message = format!("No meet named \"{}\"", args.name);
            return Err(not_found(NameKind::Meet, &args.name, message).await);
        }
        Err(error) => return Err(error),
    };
    output::emit(Report::new().table_with_data("meet", render(&meet), data(&meet)));
    Ok(())
}

pub fn render(meet: &Meet) -> Table {
    let mut table = Table::new();
    table.set_header(vec!["Meet", meet.name.as_str()]);
    let mut rows = vec![
        ("Dates", date_range(&meet.start_date, &meet.end_date)),
        ("Status", meet.status.clone()),
        ("Federation", meet.federation.clone()),
        ("Venue", meet.venue_name.clone()),
        ("Address", address(meet)),
        ("Time zone", meet.time_zone.clone()),
    ];
    if let Some(url) = &meet.venue_map_apple_url {
        rows.push(("Apple Maps", url.clone()));
    }
    if let Some(url) = &meet.venue_map_pdf_url {
        rows.push(("Venue map", url.clone()));
    }
    for (label, value) in rows {
        if !value.trim().is_empty() {
            table.add_row(vec![label.to_string(), value]);
        }
    }
    table
}

/// The details as one row, a column each, for JSON and CSV.
pub fn data(meet: &Meet) -> Table {
    let mut table = Table::new();
    table.set_header(vec![
        "Meet",
        "Start Date",
        "End Date",
        "Status",
        "Federation",
        "Venue",
        "Address",
        "Time Zone",
        "Apple Maps",
        "Venue Map",
    ]);
    table.add_row(vec![
        meet.name.clone(),
        meet.start_date.clone(),
        meet.end_date.clone(),
        meet.status.clone(),
        meet.federation.clone(),
        meet.venue_name.clone(),
        address(meet),
        meet.time_zone.clone(),
        meet.venue_map_apple_url.clone().unwrap_or_default(),
        meet.venue_map_pdf_url.clone().unwrap_or_default(),
    ]);
    table
}

/// `street, city, ST zip`, leaving out whatever the meet does not have.
pub fn address(meet: &Meet) -> String {
    let state_zip = [meet.venue_state.trim(), meet.venue_zip.trim()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    [
        meet.venue_street.trim(),
        meet.venue_city.trim(),
        state_zip.as_str(),
    ]
    .into_iter()
    .filter(|part| !part.is_empty())
    .collect::<Vec<_>>()
    .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn address_joins_the_parts_it_has() {
        let mut meet = Meet {
            name: "Test Meet".to_string(),
            federation: "USAW".to_string(),
            status: "upcoming".to_string(),
            start_date: "2026-10-03".to_string(),
            end_date: "2026-10-03".to_string(),
            time_zone: "America/New_York".to_string(),
            venue_name: "Arena".to_string(),
            venue_street: "1 Main St".to_string(),
            venue_city: "Orlando".to_string(),
            venue_state: "FL".to_string(),
            venue_zip: "32801".to_string(),
            venue_map_pdf_url: None,
            venue_map_apple_url: None,
        };
        assert_eq!(address(&meet), "1 Main St, Orlando, FL 32801");
        meet.venue_street.clear();
        meet.venue_zip.clear();
        assert_eq!(address(&meet), "Orlando, FL");
        let table = render(&meet).to_string();
        assert!(table.contains("Oct 3, 2026"));
        assert!(!table.contains("Venue map"));
        let json = Report::new()
            .table_with_data("meet", render(&meet), data(&meet))
            .to_json();
        assert_eq!(json[0]["meet"], "Test Meet");
        assert_eq!(json[0]["start_date"], "2026-10-03");
        assert_eq!(json[0]["venue_map"], serde_json::Value::Null);
    }
}
