use std::io::Write;

use anyhow::{Result, bail};
use clap::Parser;
use comfy_table::Table;

use crate::commands::leaderboard::{Filters, range};
use crate::types::lifting_results::LiftingResults;
use crate::utils::athletes::results_between;
use crate::utils::output::{self, Format, Report};
use crate::utils::stats::{
    Gender, QPOINTS_LABEL, SINCLAIR_LABEL, number, points, row_qpoints, row_sinclair,
};

/// Every result in a year or date range, with every attempt and its Sinclair: the raw data for
/// your own analysis. Best with --format csv or --format json.
///
/// Examples:
///   meetcal results --year 2025 --format csv > results-2025.csv
///   meetcal results --from 2026-06-01 --to 2026-06-30 --gender women --format json
#[derive(Parser)]
#[command(name = "results")]
pub struct ResultsArgs {
    /// Calendar year (defaults to the current year; ignored with --from)
    #[arg(long, short = 'y', value_parser = clap::value_parser!(i32).range(1900..=9999))]
    pub year: Option<i32>,

    /// Start of the range, YYYY-MM-DD (with --to)
    #[arg(long, requires = "to")]
    pub from: Option<String>,

    /// End of the range, YYYY-MM-DD (with --from)
    #[arg(long, requires = "from")]
    pub to: Option<String>,

    /// Men or Women
    #[arg(long, short = 'g')]
    pub gender: Option<String>,

    /// Age category: Senior, Junior, U17, U15, U13, U11, or Masters 35 … Masters 90
    #[arg(long, short = 'c')]
    pub category: Option<String>,

    /// Only divisions containing this text, e.g. "89kg"
    #[arg(long, short = 'd')]
    pub division: Option<String>,

    /// Only this federation, e.g. USAW or USAMW
    #[arg(long, short = 'f')]
    pub federation: Option<String>,
}

pub async fn run(args: ResultsArgs) -> Result<()> {
    let (from, to) = range(args.year, args.from.as_deref(), args.to.as_deref());
    if to < from {
        bail!("--to must not be before --from");
    }
    let gender = match args.gender.as_deref() {
        Some(value) => match Gender::parse(value) {
            Some(gender) => Some(gender),
            None => bail!("Gender must be Men or Women, not \"{value}\""),
        },
        None => None,
    };
    let filters = Filters {
        gender,
        category: args.category,
        division: args.division,
        federation: args.federation,
        adaptive: true,
    };

    let show_progress = std::io::IsTerminal::is_terminal(&std::io::stderr());
    let rows = results_between(&from, &to, |count| {
        if show_progress {
            eprint!("\rReading results… {count}");
            let _ = std::io::stderr().flush();
        }
    })
    .await?;
    if show_progress {
        eprint!("\r\x1b[2K");
    }

    let rows: Vec<&LiftingResults> = rows.iter().filter(|row| filters.keeps(row)).collect();
    let empty = format!("No results between {from} and {to} match those filters.");
    output::emit(Report::single("results", table(&rows)).when_empty(empty));
    if output::format() == Format::Table && !rows.is_empty() {
        eprintln!(
            "{} results. Use --format csv or --format json to export them.",
            rows.len()
        );
    }
    Ok(())
}

pub fn table(rows: &[&LiftingResults]) -> Table {
    let mut table = Table::new();
    table.set_header(vec![
        "Date",
        "Meet",
        "Name",
        "Division",
        "Federation",
        "BW",
        "Sn1",
        "Sn2",
        "Sn3",
        "Snatch",
        "CJ1",
        "CJ2",
        "CJ3",
        "C&J",
        "Total",
        SINCLAIR_LABEL,
        QPOINTS_LABEL,
        "Adaptive",
    ]);
    for row in rows {
        table.add_row(vec![
            row.date.clone(),
            row.meet.clone(),
            row.name.clone(),
            row.age.clone(),
            row.federation.clone(),
            number(row.body_weight),
            number(row.snatch1),
            number(row.snatch2),
            number(row.snatch3),
            number(row.snatch_best),
            number(row.cj1),
            number(row.cj2),
            number(row.cj3),
            number(row.cj_best),
            number(row.total),
            points(row_sinclair(row)),
            points(row_qpoints(row)),
            row.adaptive.to_string(),
        ]);
    }
    table
}
