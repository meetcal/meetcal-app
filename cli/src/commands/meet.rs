use crate::{
    types::athletes::{Athletes, Platform},
    utils::api::get_api_response_with_query,
};
use anyhow::Result;
use clap::Parser;
use comfy_table::Table;
use std::collections::HashMap;

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
}

pub async fn run(args: MeetArgs) -> Result<()> {
    let meet_name = args.name;
    let session_number = args.session_number;
    let session_platform = args.session_platform.map(|p| match p {
        Platform::Red => String::from("Red"),
        Platform::White => String::from("White"),
        Platform::Blue => String::from("Blue"),
        Platform::Stars => String::from("Stars"),
        Platform::Stripes => String::from("Stripes"),
        Platform::Rogue => String::from("Rogue"),
    });

    let mut query_args = HashMap::new();
    query_args.insert("meet", meet_name);
    if session_number.is_some() {
        query_args.insert("session_number", session_number.unwrap_or("1".to_string()));
    }
    if session_platform.is_some() {
        query_args.insert("platform", session_platform.unwrap_or("Red".to_string()));
    }

    let response: Vec<Athletes> =
        get_api_response_with_query("/meets/athletes-sessions", &query_args).await?;

    let mut table = Table::new();
    table.set_header(vec![
        "Name",
        "Age",
        "Gender",
        "Adaptive",
        "Club",
        "Class",
        "Entry Total",
        "Session Num",
        "Platform",
    ]);

    for athlete in response {
        table.add_row(vec![
            athlete.name,
            athlete.age.to_string(),
            athlete.gender,
            athlete.adaptive.to_string(),
            athlete.club,
            athlete.weight_class,
            athlete.entry_total.to_string(),
            athlete
                .session_number
                .map(|n| n.to_string())
                .unwrap_or_else(|| "Not set".to_string()),
            athlete
                .session_platform
                .map(|p| format!("{p:?}"))
                .unwrap_or_else(|| "Not set".to_string()),
        ]);
    }

    println!("{table}");

    Ok(())
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
        assert!(matches!(row.session_platform, Some(Platform::Red)));
        assert_eq!(row.wso, None);
    }

    #[test]
    fn rejects_missing_field() {
        let bad_json = r#"[{ "name": "Jane Doe", "gender": "Men" }]"#;
        let result: Result<Vec<Athletes>, _> = serde_json::from_str(bad_json);
        assert!(result.is_err());
    }
}
