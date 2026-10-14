use std::collections::BTreeMap;

use anyhow::Result;
use clap::Parser;
use comfy_table::Table;
use serde_json::json;

use crate::types::meets::ScheduleRow;
use crate::utils::backend::{queries, query};
use crate::utils::filters::{Filter, no_match, parse_date};
use crate::utils::format::{time_24h, us_date, us_time};
use crate::utils::names::{NameKind, not_found};
use crate::utils::output::{self, Report};

/// Show a meet's session schedule: each session's date, platform, weigh-in and start times (in
/// the meet's time zone), and weight classes.
#[derive(Parser)]
#[command(
    name = "schedule",
    after_help = r#"Examples:
  meetcal schedule "2026 Florida State Championships (WSO Championships)"
  meetcal schedule "2026 Florida State Championships (WSO Championships)" --date 2026-09-26"#
)]
pub struct ScheduleArgs {
    /// Exact meet name (see `meetcal meets`)
    pub name: String,

    /// Only this day's sessions (YYYY-MM-DD)
    #[arg(long, short = 'd', value_parser = parse_date)]
    pub date: Option<String>,

    /// Only this platform's sessions (case-insensitive)
    #[arg(long, short = 'p')]
    pub platform: Option<String>,
}

/// One session on one platform, with its weight classes.
#[derive(Clone, Debug, PartialEq)]
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

    let all = sessions(rows);
    let filters = [
        Filter {
            option: "--date",
            value: args.date.as_deref().unwrap_or_default(),
        },
        Filter {
            option: "--platform",
            value: args.platform.as_deref().unwrap_or_default(),
        },
    ];
    let wanted = |index: usize| (!filters[index].value.is_empty()).then_some(index);
    let sessions: Vec<Session> = all
        .iter()
        .filter(|session| wanted(0).is_none_or(|_| session.date == filters[0].value))
        .filter(|session| {
            wanted(1).is_none_or(|_| {
                session
                    .platform
                    .eq_ignore_ascii_case(filters[1].value.trim())
            })
        })
        .cloned()
        .collect();
    if sessions.is_empty() {
        // Name the filter that matched nothing, with the days or platforms the meet has.
        let given: Vec<usize> = (0..filters.len()).filter_map(wanted).collect();
        let rows: Vec<Vec<&str>> = all
            .iter()
            .map(|session| {
                let values = [session.date.as_str(), session.platform.as_str()];
                given.iter().map(|&index| values[index]).collect()
            })
            .collect();
        let given_filters: Vec<Filter> = given
            .iter()
            .map(|&index| Filter {
                option: filters[index].option,
                value: filters[index].value,
            })
            .collect();
        return Err(no_match("sessions", &given_filters, &rows));
    }

    output::emit(
        Report::new()
            .table_with_data(
                "sessions",
                table(&sessions, us_date, us_time),
                table(&sessions, str::to_string, time_24h),
            )
            .when_empty("No sessions match those filters."),
    );
    Ok(())
}

/// The sessions, with dates and times written by `date` and `time`: US dates and 12-hour times
/// to show, `YYYY-MM-DD` and 24-hour `HH:MM` to export.
pub fn table(sessions: &[Session], date: fn(&str) -> String, time: fn(&str) -> String) -> Table {
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
            date(&session.date),
            session.session.to_string(),
            session.platform.clone(),
            time(&session.weigh_in_time),
            time(&session.start_time),
            session.weight_classes.join(", "),
        ]);
    }
    table
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
