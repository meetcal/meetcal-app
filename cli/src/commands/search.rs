use crate::{
    types::lifting_results::{LiftingResults, PRs},
    utils::{
        backend::{queries, query},
        make_rate::make_rate_tables,
        output::{self, Report},
        stats::plausible_row,
    },
};
use anyhow::Result;
use clap::Parser;
use comfy_table::Table;

/// Search for an athlete's name to see their Comp PRs and Results.
///
/// Examples:
///   meetcal search "Maddisen Mohnsen"
#[derive(Parser)]
#[command(name = "search")]
pub struct SearchArgs {
    /// Athlete name to search for
    pub name: String,
}

pub async fn run(args: SearchArgs) -> Result<()> {
    let name = args.name;

    let query_args = serde_json::json!({ "names": [name] });
    let results: Vec<LiftingResults> = query(queries::RESULTS_BY_NAMES, &query_args).await?;

    let mut meets_table = Table::new();

    meets_table.set_header(vec![
        "Meet", "Date", "Age", "Sn1", "Sn2", "Sn3", "CJ1", "CJ2", "CJ3", "Total",
    ]);

    for meet in &results {
        meets_table.add_row(vec![
            meet.meet.to_string(),
            meet.date.to_string(),
            meet.age.to_string(),
            meet.snatch1.to_string(),
            meet.snatch2.to_string(),
            meet.snatch3.to_string(),
            meet.cj1.to_string(),
            meet.cj2.to_string(),
            meet.cj3.to_string(),
            meet.total.to_string(),
        ]);
    }

    let mut pr_table = Table::new();

    pr_table.set_header(vec!["Snatch PR", "CJ PR", "Total PR"]);

    let prs = get_prs(&results);

    pr_table.add_row(vec![
        prs.snatch_best.to_string(),
        prs.cj_best.to_string(),
        prs.total_best.to_string(),
    ]);

    let (by_attempt, by_lift) = make_rate_tables(&results);
    output::emit(
        Report::new()
            .table("results", meets_table)
            .table("prs", pr_table)
            .table("make_rate_by_attempt", by_attempt)
            .table("make_rate", by_lift),
    );

    Ok(())
}

/// The best snatch, clean & jerk and total, source errors left out (`plausible_row`).
pub fn get_prs(results: &[LiftingResults]) -> PRs {
    results.iter().filter(|row| plausible_row(row)).fold(
        PRs {
            snatch_best: 0.0,
            cj_best: 0.0,
            total_best: 0.0,
        },
        |acc, meet| PRs {
            snatch_best: acc.snatch_best.max(meet.snatch_best),
            cj_best: acc.cj_best.max(meet.cj_best),
            total_best: acc.total_best.max(meet.total),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::stats::tests::row;

    #[test]
    fn prs_leave_source_errors_out() {
        let rows = vec![
            row(
                "Ada",
                "2026-01-01",
                "M1",
                "Open Women's 64kg",
                63.0,
                [60.0, 63.0, 0.0],
                [80.0, 0.0, 0.0],
            ),
            row(
                "Ada",
                "2026-02-01",
                "M2",
                "Open Women's 64kg",
                63.0,
                [-63.0, 633.0, 65.0],
                [85.0, 0.0, 0.0],
            ),
        ];
        let prs = get_prs(&rows);
        assert_eq!(prs.snatch_best, 63.0);
        assert_eq!(prs.cj_best, 80.0);
        assert_eq!(prs.total_best, 143.0);
    }
}
