use std::collections::BTreeMap;

use anyhow::Result;
use clap::Parser;
use comfy_table::Table;
use serde_json::json;

use crate::types::meets::ScheduleRow;
use crate::utils::backend::{queries, query};
use crate::utils::format::{us_date, us_time};
use crate::utils::names::{NameKind, not_found};
use crate::utils::output::{self, Report};

/// Show a meet's session schedule: each session's date, platform, weigh-in and start times (in
/// the meet's time zone), and weight classes.
///
/// Examples:
///   meetcal schedule "2026 Florida State Championships (WSO Championships)"
///   meetcal schedule "2026 Florida State Championships (WSO Championships)" --date 2026-10-03
#[derive(Parser)]
#[command(name = "schedule")]
pub struct ScheduleArgs {
    /// Exact meet name (see `meetcal meets`)
    pub name: String,

    /// Only this day's sessions (YYYY-MM-DD)
    #[arg(long, short = 'd')]
    pub date: Option<String>,

    /// Only this platform's sessions (case-insensitive)
    #[arg(long, short = 'p')]
    pub platform: Option<String>,
}

/// One session on one platform, with its weight classes.
#[derive(Debug, PartialEq)]
pub struct Session {
    pub date: String,
    pub session: u32,
    pub platform: String,
    pub weigh_in_time: String,
    pub start_time: String,
    pub weight_classes: Vec<String>,
}

pub async fn run(args: ScheduleArgs) -> Result<()> {
    let rows: Vec<ScheduleRow> =
        query(queries::MEET_SCHEDULE, &json!({ "meet": args.name })).await?;
    if rows.is_empty() {
        let message = format!("No schedule found for meet \"{}\"", args.name);
        return Err(not_found(NameKind::Meet, &args.name, message).await);
    }

    let sessions: Vec<Session> = sessions(rows)
        .into_iter()
        .filter(|session| {
            args.date
                .as_deref()
                .is_none_or(|date| session.date == date.trim())
        })
        .filter(|session| {
            args.platform
                .as_deref()
                .is_none_or(|platform| session.platform.eq_ignore_ascii_case(platform.trim()))
        })
        .collect();

    let mut table = Table::new();
    table.set_header(vec![
        "Date",
        "Session",
        "Platform",
        "Weigh-in",
        "Start",
        "Weight classes",
    ]);
    for session in sessions {
        table.add_row(vec![
            us_date(&session.date),
            session.session.to_string(),
            session.platform,
            us_time(&session.weigh_in_time),
            us_time(&session.start_time),
            session.weight_classes.join(", "),
        ]);
    }
    output::emit(Report::single("sessions", table).when_empty("No sessions match those filters."));
    Ok(())
}

/// Schedule rows (one per session, platform and weight class) grouped into sessions, in the
/// schedule's order.
pub fn sessions(rows: Vec<ScheduleRow>) -> Vec<Session> {
    let mut order = Vec::new();
    let mut grouped: BTreeMap<(String, u32, String), Session> = BTreeMap::new();
    for row in rows {
        let session = row.session_id as u32;
        let key = (row.date.clone(), session, row.platform.clone());
        let entry = grouped.entry(key.clone()).or_insert_with(|| {
            order.push(key);
            Session {
                date: row.date,
                session,
                platform: row.platform,
                weigh_in_time: row.weigh_in_time,
                start_time: row.start_time,
                weight_classes: Vec::new(),
            }
        });
        if !entry.weight_classes.contains(&row.weight_class) {
            entry.weight_classes.push(row.weight_class);
        }
    }
    order
        .into_iter()
        .filter_map(|key| grouped.remove(&key))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(date: &str, session: f64, platform: &str, class: &str) -> ScheduleRow {
        ScheduleRow {
            date: date.to_string(),
            session_id: session,
            platform: platform.to_string(),
            weigh_in_time: "08:00".to_string(),
            start_time: "10:00".to_string(),
            weight_class: class.to_string(),
        }
    }

    #[test]
    fn groups_weight_classes_by_session_in_schedule_order() {
        let grouped = sessions(vec![
            row("2026-10-03", 1.0, "Red", "W 58"),
            row("2026-10-03", 1.0, "Red", "W 63"),
            row("2026-10-03", 1.0, "Blue", "M 60"),
            row("2026-10-03", 1.0, "Red", "W 58"),
            row("2026-10-04", 2.0, "Red", "M 88"),
        ]);
        assert_eq!(grouped.len(), 3);
        assert_eq!(grouped[0].platform, "Red");
        assert_eq!(grouped[0].weight_classes, ["W 58", "W 63"]);
        assert_eq!(grouped[1].platform, "Blue");
        assert_eq!(grouped[2].session, 2);
    }
}
