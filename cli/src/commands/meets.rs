use anyhow::Result;
use clap::Parser;
use comfy_table::Table;

use crate::types::meets::Meet;
use crate::utils::format::date_range;
use crate::utils::names::{completed_meets, upcoming_meets};
use crate::utils::output::{self, Report};

/// List meets: upcoming (starting within three months, or under way), or completed.
///
/// Examples:
///   meetcal meets
///   meetcal meets --completed --search virus
#[derive(Parser)]
#[command(name = "meets")]
pub struct MeetsArgs {
    /// List completed meets, newest first, instead of upcoming ones
    #[arg(long, short = 'c')]
    pub completed: bool,

    /// Only meets whose name contains this text (case-insensitive)
    #[arg(long, short = 's')]
    pub search: Option<String>,
}

pub async fn run(args: MeetsArgs) -> Result<()> {
    let meets = if args.completed {
        completed_meets().await?
    } else {
        upcoming_meets().await?
    };
    let meets = matching(meets, args.search.as_deref());

    let which = if args.completed {
        "completed"
    } else {
        "upcoming"
    };
    let empty = match &args.search {
        Some(search) => format!("No {which} meets match \"{search}\"."),
        None => format!("No {which} meets."),
    };

    let mut table = Table::new();
    table.set_header(vec!["Meet", "Dates", "Location", "Status"]);
    for meet in meets {
        table.add_row(vec![
            meet.name.clone(),
            date_range(&meet.start_date, &meet.end_date),
            location(&meet),
            meet.status.clone(),
        ]);
    }
    output::emit(Report::single("meets", table).when_empty(empty));
    Ok(())
}

/// The meets whose name contains `search`, ignoring case; all of them without one.
pub fn matching(meets: Vec<Meet>, search: Option<&str>) -> Vec<Meet> {
    let Some(search) = search.map(str::trim).filter(|search| !search.is_empty()) else {
        return meets;
    };
    let search = search.to_lowercase();
    meets
        .into_iter()
        .filter(|meet| meet.name.to_lowercase().contains(&search))
        .collect()
}

/// `City, ST`, or whichever of the two the meet has.
pub fn location(meet: &Meet) -> String {
    [meet.venue_city.trim(), meet.venue_state.trim()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meet(name: &str, city: &str, state: &str) -> Meet {
        Meet {
            name: name.to_string(),
            federation: "USAW".to_string(),
            status: "upcoming".to_string(),
            start_date: "2026-10-03".to_string(),
            end_date: "2026-10-04".to_string(),
            time_zone: "America/New_York".to_string(),
            venue_name: "Arena".to_string(),
            venue_street: "1 Main St".to_string(),
            venue_city: city.to_string(),
            venue_state: state.to_string(),
            venue_zip: "32801".to_string(),
            venue_map_pdf_url: None,
            venue_map_apple_url: None,
        }
    }

    #[test]
    fn search_matches_names_ignoring_case() {
        let meets = vec![
            meet("2026 Virus Series 2", "Columbus", "OH"),
            meet("2026 Florida State Championships", "Orlando", "FL"),
        ];
        let found = matching(meets.clone(), Some(" VIRUS "));
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "2026 Virus Series 2");
        assert_eq!(matching(meets.clone(), None).len(), 2);
        assert_eq!(matching(meets, Some("")).len(), 2);
    }

    #[test]
    fn location_leaves_out_missing_parts() {
        assert_eq!(location(&meet("A", "Orlando", "FL")), "Orlando, FL");
        assert_eq!(location(&meet("A", "", "FL")), "FL");
    }

    #[test]
    fn meets_parse_from_the_api_shape() {
        let json = r#"[{"id":"m1","name":"Test Meet","federation":"USAW","status":"upcoming",
            "start_date":"2026-10-03","end_date":"2026-10-04","time_zone":"America/New_York",
            "venue_name":"Arena","venue_street":"1 Main St","venue_city":"Orlando",
            "venue_state":"FL","venue_zip":"32801","venue_map_pdf_url":null,
            "venue_map_apple_url":"https://maps.apple.com/?q=Arena"}]"#;
        let meets: Vec<Meet> = serde_json::from_str(json).unwrap();
        assert_eq!(
            meets[0].venue_map_apple_url.as_deref(),
            Some("https://maps.apple.com/?q=Arena")
        );
        assert_eq!(meets[0].venue_map_pdf_url, None);
    }
}
