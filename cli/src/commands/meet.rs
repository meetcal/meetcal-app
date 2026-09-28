use crate::utils::output::{self, Report};
use crate::{
    types::athletes::{Athletes, Platform},
    utils::{
        backend::{queries, query},
        bests::{bests_cell, year_bests},
        format::{us_date, us_time},
        names::{NameKind, not_found},
    },
};
use std::collections::HashMap;

use anyhow::{Context, Result, bail};
use clap::Parser;
use comfy_table::Table;

/// Search for entries for a meet.
///
/// Examples:
///   meetcal meet "2026 VIRUS Weightlifting Series 1" --session-number 1 --session-platform red
///   meetcal meet "2026 Virus Weightlifting Series 2, Powered by Rogue Fitness"
#[derive(Parser)]
#[command(name = "meet")]
pub struct MeetArgs {
    /// Meet to search for
    pub name: String,

    /// Session number to search for
    #[arg(long, short = 's')]
    pub session_number: Option<String>,

    /// Session platform to search for
    #[arg(long, short = 'p')]
    pub session_platform: Option<Platform>,

    /// Leave out each athlete's past-year bests (one fewer lookup per 100 athletes)
    #[arg(long)]
    pub no_bests: bool,
}

pub async fn run(args: MeetArgs) -> Result<()> {
    let meet_name = args.name.clone();
    let session_number = args.session_number.clone();
    let narrowed = session_number.is_some() || args.session_platform.is_some();
    let session_platform = args.session_platform.clone().map(|p| match p {
        Platform::Red => String::from("Red"),
        Platform::White => String::from("White"),
        Platform::Blue => String::from("Blue"),
        Platform::Stars => String::from("Stars"),
        Platform::Stripes => String::from("Stripes"),
        Platform::Rogue => String::from("Rogue"),
    });

    let mut query_args = serde_json::json!({ "meet": meet_name });
    if let Some(session_number) = session_number {
        let session_number: u32 = session_number.trim().parse().with_context(|| {
            format!("Session number must be a whole number, not {session_number:?}")
        })?;
        query_args["sessionNumber"] = session_number.into();
    }
    if let Some(platform) = session_platform {
        query_args["platform"] = platform.into();
    }

    let response: Vec<Athletes> = query(queries::MEET_ATHLETES_SESSIONS, &query_args).await?;
    if response.is_empty() {
        let message = if narrowed {
            format!("No athletes found in that session of meet \"{meet_name}\"")
        } else {
            format!("No athletes found for meet \"{meet_name}\"")
        };
        if narrowed {
            bail!(message);
        }
        return Err(not_found(NameKind::Meet, &meet_name, message).await);
    }

    let bests = if args.no_bests {
        HashMap::new()
    } else {
        let names: Vec<String> = response
            .iter()
            .map(|athlete| athlete.name.clone())
            .collect();
        year_bests(&names).await?
    };

    let mut table = Table::new();
    let mut header = vec![
        "Name",
        "Age",
        "Gender",
        "Adaptive",
        "Club",
        "Class",
        "Entry Total",
        "Session",
        "Date",
        "Weigh-in",
        "Start",
    ];
    if !args.no_bests {
        header.push("Past-year bests\n(Sn / CJ / Total)");
    }
    table.set_header(header);

    for athlete in response {
        let mut row = vec![
            athlete.name.clone(),
            athlete.age.to_string(),
            athlete.gender,
            athlete.adaptive.to_string(),
            athlete.club,
            athlete.weight_class,
            athlete.entry_total.to_string(),
            session_label(athlete.session_number, athlete.session_platform.as_deref()),
            athlete.date.as_deref().map(us_date).unwrap_or_default(),
            athlete
                .weigh_in_time
                .as_deref()
                .map(us_time)
                .unwrap_or_default(),
            athlete
                .start_time
                .as_deref()
                .map(us_time)
                .unwrap_or_default(),
        ];
        if !args.no_bests {
            row.push(bests_cell(bests.get(&athlete.name)));
        }
        table.add_row(row);
    }

    output::emit(Report::single("start_list", table));

    Ok(())
}

/// `1 · Red`, whichever part the athlete has, or `Not set`.
pub fn session_label(number: Option<f64>, platform: Option<&str>) -> String {
    match (number, platform) {
        (Some(number), Some(platform)) => format!("{number} · {platform}"),
        (Some(number), None) => number.to_string(),
        (None, Some(platform)) => platform.to_string(),
        (None, None) => "Not set".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const JSON: &str = r#"[
        {
            "adaptive": false,
            "age": 25,
            "club": "Test Club",
            "entry_total": 250,
            "gender": "Men",
            "meet": "American Open Finals",
            "member_id": "12345",
            "name": "Jane Doe",
            "session_number": 1,
            "session_platform": "Red",
            "weight_class": "81kg",
            "wso": null
        }
    ]"#;

    #[test]
    fn parse_backend_response() {
        let athletes: Vec<Athletes> = serde_json::from_str(JSON).unwrap();

        let row = &athletes[0];
        assert_eq!(row.name, "Jane Doe");
        assert_eq!(row.age, 25.0);
        assert_eq!(row.gender, "Men");
        assert!(!row.adaptive);
        assert_eq!(row.club, "Test Club");
        assert_eq!(row.weight_class, "81kg");
        assert_eq!(row.entry_total, 250.0);
        assert_eq!(row.meet, "American Open Finals");
        assert_eq!(row.member_id, "12345");
        assert_eq!(row.session_number, Some(1.0));
        assert_eq!(row.session_platform.as_deref(), Some("Red"));
        assert_eq!(row.wso, None);
    }

    #[test]
    fn parses_start_list_rows_without_a_meet_or_with_other_platforms() {
        let rows = r#"[{
            "adaptive": false, "age": 31, "club": "Test Club", "entry_total": 180,
            "gender": "Women", "member_id": "9", "name": "Ada Lift", "session_number": 4,
            "session_platform": "Gold", "weight_class": "63kg", "wso": "Florida",
            "date": "2026-10-03", "start_time": "10:00", "weigh_in_time": "08:00"
        }]"#;
        let athletes: Vec<Athletes> = serde_json::from_str(rows).unwrap();

        assert_eq!(athletes[0].meet, "");
        assert_eq!(athletes[0].session_platform.as_deref(), Some("Gold"));
    }

    #[test]
    fn session_label_shows_number_and_platform() {
        assert_eq!(session_label(Some(1.0), Some("Red")), "1 · Red");
        assert_eq!(session_label(Some(2.0), None), "2");
        assert_eq!(session_label(None, None), "Not set");
    }

    #[test]
    fn start_list_rows_carry_session_times() {
        let rows = r#"[{
            "adaptive": false, "age": 31, "club": "Test Club", "entry_total": 180,
            "gender": "Women", "member_id": "9", "name": "Ada Lift", "session_number": 4,
            "session_platform": "Red", "weight_class": "63kg", "wso": "Florida",
            "date": "2026-10-03", "start_time": "10:00", "weigh_in_time": "08:00"
        }]"#;
        let athletes: Vec<Athletes> = serde_json::from_str(rows).unwrap();
        assert_eq!(athletes[0].date.as_deref(), Some("2026-10-03"));
        assert_eq!(athletes[0].weigh_in_time.as_deref(), Some("08:00"));
        assert_eq!(athletes[0].start_time.as_deref(), Some("10:00"));
    }

    #[test]
    fn rejects_missing_field() {
        let bad_json = r#"[{ "name": "Jane Doe", "gender": "Men" }]"#;
        let result: Result<Vec<Athletes>, _> = serde_json::from_str(bad_json);
        assert!(result.is_err());
    }
}
