use crate::utils::output::{self, Report};
use crate::{
    types::athletes::Athletes,
    types::meets::NamedBests,
    utils::{
        backend::{queries, query},
        bests::{bests_cell, year_bests},
        format::{kg, time_24h, us_date, us_time},
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

    /// Session platform, as the meet names it, e.g. Red, White, Blue, Stars, Stripes, Rogue or
    /// Gold (case-insensitive)
    #[arg(long, short = 'p')]
    pub session_platform: Option<String>,

    /// Leave out each athlete's past-year bests (one fewer lookup per 100 athletes)
    #[arg(long)]
    pub no_bests: bool,
}

pub async fn run(args: MeetArgs) -> Result<()> {
    let meet_name = args.name.clone();
    let session_number = args.session_number.clone();
    let narrowed = session_number.is_some() || args.session_platform.is_some();
    let session_platform = session_platform(args.session_platform.as_deref())?;

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
        // An empty session and a misspelled meet both answer nothing: the whole start list
        // tells them apart.
        let roster: Vec<Athletes> = if narrowed {
            query(
                queries::MEET_ATHLETES_SESSIONS,
                &serde_json::json!({ "meet": meet_name }),
            )
            .await?
        } else {
            Vec::new()
        };
        if roster.is_empty() {
            let message = format!("No athletes found for meet \"{meet_name}\"");
            return Err(not_found(NameKind::Meet, &meet_name, message).await);
        }
        bail!(empty_session_message(&meet_name, &roster));
    }

    let bests = if args.no_bests {
        None
    } else {
        let names: Vec<String> = response
            .iter()
            .map(|athlete| athlete.name.clone())
            .collect();
        Some(year_bests(&names).await?)
    };

    output::emit(report(&response, bests.as_ref()));

    Ok(())
}

/// The platform filter to send, trimmed. Platforms are the meet's own names (Red, Gold,
/// Platform A); the server matches them ignoring case. A blank one is an error: dropping it
/// would print the whole roster as though it matched.
pub fn session_platform(platform: Option<&str>) -> Result<Option<String>> {
    let Some(platform) = platform else {
        return Ok(None);
    };
    let platform = platform.trim();
    if platform.is_empty() {
        bail!("Session platform must not be blank: give the platform's name, e.g. Red or Gold");
    }
    Ok(Some(platform.to_string()))
}

/// The start list: shown with US dates, 12-hour times, and the session, platform and past-year
/// bests packed into cells; exported with ISO dates, 24-hour times and a column for each.
/// `bests` is `None` when they were not asked for.
pub fn report(athletes: &[Athletes], bests: Option<&HashMap<String, NamedBests>>) -> Report {
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
    if bests.is_some() {
        header.push("Past-year bests\n(Sn / CJ / Total)");
    }
    table.set_header(header);

    let mut data = Table::new();
    let mut data_header = vec![
        "Name",
        "Age",
        "Gender",
        "Adaptive",
        "Club",
        "Class",
        "Entry Total",
        "Session",
        "Platform",
        "Date",
        "Weigh-in",
        "Start",
    ];
    if bests.is_some() {
        data_header.extend([
            "Past-Year Best Snatch",
            "Past-Year Best CJ",
            "Past-Year Best Total",
        ]);
    }
    data.set_header(data_header);

    for athlete in athletes {
        let date = athlete.date.clone().unwrap_or_default();
        let weigh_in = athlete.weigh_in_time.clone().unwrap_or_default();
        let start = athlete.start_time.clone().unwrap_or_default();
        let common = vec![
            athlete.name.clone(),
            athlete.age.to_string(),
            athlete.gender.clone(),
            athlete.adaptive.to_string(),
            athlete.club.clone(),
            athlete.weight_class.clone(),
            athlete.entry_total.to_string(),
        ];

        let mut row = common.clone();
        row.extend([
            session_label(athlete.session_number, athlete.session_platform.as_deref()),
            us_date(&date),
            us_time(&weigh_in),
            us_time(&start),
        ]);
        let mut data_row = common;
        data_row.extend([
            athlete
                .session_number
                .map(|number| number.to_string())
                .unwrap_or_default(),
            athlete.session_platform.clone().unwrap_or_default(),
            date,
            time_24h(&weigh_in),
            time_24h(&start),
        ]);
        if let Some(bests) = bests {
            let best = bests.get(&athlete.name);
            row.push(bests_cell(best));
            data_row.extend(
                [
                    best.map(|best| best.best_snatch),
                    best.map(|best| best.best_cj),
                    best.map(|best| best.best_total),
                ]
                .map(|lift| lift.map(kg).unwrap_or_default()),
            );
        }
        table.add_row(row);
        data.add_row(data_row);
    }

    Report::new().table_with_data("start_list", table, data)
}

/// Why a session filter found no one at a meet that has a start list: the sessions it does have,
/// one line per session number with its platforms.
pub fn empty_session_message(meet: &str, roster: &[Athletes]) -> String {
    let mut sessions: std::collections::BTreeMap<u64, Vec<String>> = Default::default();
    for athlete in roster {
        let Some(number) = athlete.session_number else {
            continue;
        };
        let platforms = sessions.entry(number as u64).or_default();
        if let Some(platform) = athlete.session_platform.as_deref()
            && !platforms.iter().any(|known| known == platform)
        {
            platforms.push(platform.to_string());
        }
    }
    let message = format!("No athletes found in that session of meet \"{meet}\"");
    if sessions.is_empty() {
        return format!("{message}; its athletes have no sessions yet.");
    }
    let list: Vec<String> = sessions
        .into_iter()
        .map(|(number, mut platforms)| {
            platforms.sort();
            if platforms.is_empty() {
                format!("  {number}")
            } else {
                format!("  {number}: {}", platforms.join(", "))
            }
        })
        .collect();
    format!(
        "{message}. Its sessions (--session-number: --session-platform):\n{}",
        list.join("\n")
    )
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
    fn a_blank_platform_is_an_error_not_the_whole_roster() {
        assert!(session_platform(Some("  ")).is_err());
        assert!(session_platform(Some("")).is_err());
        assert_eq!(session_platform(None).unwrap(), None);
        assert_eq!(
            session_platform(Some(" Red ")).unwrap().as_deref(),
            Some("Red")
        );
    }

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
    fn an_empty_session_lists_the_meet_s_sessions() {
        let rows = r#"[
            { "adaptive": false, "age": 31, "club": "C", "entry_total": 180, "gender": "Women",
              "member_id": "1", "name": "A", "session_number": 2, "session_platform": "Gold",
              "weight_class": "63kg", "wso": null },
            { "adaptive": false, "age": 31, "club": "C", "entry_total": 180, "gender": "Women",
              "member_id": "2", "name": "B", "session_number": 1, "session_platform": "Red",
              "weight_class": "63kg", "wso": null },
            { "adaptive": false, "age": 31, "club": "C", "entry_total": 180, "gender": "Women",
              "member_id": "3", "name": "C", "session_number": 2, "session_platform": "Gold",
              "weight_class": "63kg", "wso": null }
        ]"#;
        let roster: Vec<Athletes> = serde_json::from_str(rows).unwrap();
        assert_eq!(
            empty_session_message("Meet", &roster),
            "No athletes found in that session of meet \"Meet\". Its sessions \
             (--session-number: --session-platform):\n  1: Red\n  2: Gold"
        );
        assert_eq!(
            empty_session_message("Meet", &[]),
            "No athletes found in that session of meet \"Meet\"; its athletes have no sessions yet."
        );
    }

    #[test]
    fn exports_dates_times_session_platform_and_bests_apart() {
        let rows = r#"[{
            "adaptive": false, "age": 31, "club": "Test Club", "entry_total": 180,
            "gender": "Women", "member_id": "9", "name": "Ada Lift", "session_number": 4,
            "session_platform": "Red", "weight_class": "63kg", "wso": "Florida",
            "date": "2026-10-03", "start_time": "10:00:00", "weigh_in_time": "08:00"
        }, {
            "adaptive": true, "age": 40, "club": "Test Club", "entry_total": 150,
            "gender": "Men", "member_id": "10", "name": "Bo Lift", "session_number": null,
            "session_platform": null, "weight_class": "81kg", "wso": null
        }]"#;
        let athletes: Vec<Athletes> = serde_json::from_str(rows).unwrap();
        let mut bests = HashMap::new();
        bests.insert(
            "Ada Lift".to_string(),
            NamedBests {
                name: "Ada Lift".to_string(),
                best_snatch: 80.0,
                best_cj: 100.0,
                best_total: 180.0,
            },
        );
        let report = report(&athletes, Some(&bests));
        let json = report.to_json();
        assert_eq!(json[0]["session"], 4);
        assert_eq!(json[0]["platform"], "Red");
        assert_eq!(json[0]["date"], "2026-10-03");
        assert_eq!(json[0]["weigh_in"], "08:00");
        assert_eq!(json[0]["start"], "10:00");
        assert_eq!(json[0]["adaptive"], false);
        assert_eq!(json[0]["past_year_best_total"], 180);
        assert_eq!(json[1]["session"], serde_json::Value::Null);
        assert_eq!(json[1]["platform"], serde_json::Value::Null);
        assert_eq!(json[1]["adaptive"], true);
        assert_eq!(json[1]["past_year_best_snatch"], serde_json::Value::Null);
        let text = report.to_text();
        assert!(text.contains("4 · Red"));
        assert!(text.contains("Oct 3, 2026"));
        assert!(text.contains("10:00 AM"));
        assert!(text.contains("Not set"));
    }

    #[test]
    fn rejects_missing_field() {
        let bad_json = r#"[{ "name": "Jane Doe", "gender": "Men" }]"#;
        let result: Result<Vec<Athletes>, _> = serde_json::from_str(bad_json);
        assert!(result.is_err());
    }
}
