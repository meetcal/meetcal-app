use anyhow::Result;
use clap::Parser;

use crate::utils::names::{MAX_SUGGESTIONS, clubs};
use crate::utils::output::{self, Report};

/// List club names, as the other club commands expect them.
///
/// Examples:
///   meetcal clubs --search "texas barbell"
///   meetcal clubs
#[derive(Parser)]
#[command(name = "clubs")]
pub struct ClubsArgs {
    /// Only clubs whose name contains this text (case-insensitive)
    #[arg(long, short = 's')]
    pub search: Option<String>,
}

pub async fn run(args: ClubsArgs) -> Result<()> {
    let clubs = clubs().await?;
    let search = args
        .search
        .as_deref()
        .map(str::trim)
        .filter(|search| !search.is_empty());
    let Some(search) = search else {
        output::emit(Report::single("clubs", output::list("Club", clubs)));
        return Ok(());
    };

    let matches = matching(&clubs, search);
    let message = if matches.is_empty() {
        let close = crate::utils::names::closest(search, &clubs, MAX_SUGGESTIONS);
        if close.is_empty() {
            format!("No club names contain \"{search}\".")
        } else {
            let list: Vec<String> = close.iter().map(|name| format!("  {name}")).collect();
            format!(
                "No club names contain \"{search}\". Did you mean:\n{}",
                list.join("\n")
            )
        }
    } else {
        String::new()
    };
    output::emit(Report::single("clubs", output::list("Club", matches)).when_empty(message));
    Ok(())
}

/// The names containing `search`, ignoring case.
pub fn matching<'a>(names: &'a [String], search: &str) -> Vec<&'a str> {
    let search = search.to_lowercase();
    names
        .iter()
        .filter(|name| name.to_lowercase().contains(&search))
        .map(String::as_str)
        .collect()
}
