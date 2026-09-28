use anyhow::Result;
use clap::Parser;

use crate::utils::names::{MAX_SUGGESTIONS, clubs};

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
        println!("{}", clubs.join("\n"));
        return Ok(());
    };

    let matches = matching(&clubs, search);
    if matches.is_empty() {
        let close = crate::utils::names::closest(search, &clubs, MAX_SUGGESTIONS);
        if close.is_empty() {
            println!("No club names contain \"{search}\".");
        } else {
            println!("No club names contain \"{search}\". Did you mean:");
            for name in close {
                println!("  {name}");
            }
        }
        return Ok(());
    }
    println!("{}", matches.join("\n"));
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
