use crate::{
    types::lifting_results::{LiftingResults, PRs},
    utils::{
        athletes::history,
        format::kg,
        make_rate::make_rate_tables,
        output::{self, Report},
        stats::{Lift, valid_lift, valid_total},
    },
};
use anyhow::Result;
use clap::Parser;
use comfy_table::Table;

/// Search for an athlete's name to see their Comp PRs and Results.
#[derive(Parser)]
#[command(
    name = "search",
    after_help = r#"Examples:
  meetcal search "Maddisen Mohnsen""#
)]
pub struct SearchArgs {
    /// Athlete name to search for
    #[arg(value_parser = crate::utils::filters::parse_name)]
    pub name: String,
}

pub async fn run(args: SearchArgs) -> Result<()> {
    let results: Vec<LiftingResults> = history(&args.name).await?;
    output::emit(report(&results));
    Ok(())
}

pub fn report(results: &[LiftingResults]) -> Report {
    let mut meets_table = Table::new();
    meets_table.set_header(vec![
        "Meet", "Date", "Age", "Sn1", "Sn2", "Sn3", "CJ1", "CJ2", "CJ3", "Total",
    ]);
    for meet in results {
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

    let prs = get_prs(results);
    let pr_header = vec!["Snatch PR", "CJ PR", "Total PR"];
    let mut pr_table = Table::new();
    pr_table.set_header(pr_header.clone());
    pr_table.add_row(vec![
        prs.snatch_best.to_string(),
        prs.cj_best.to_string(),
        prs.total_best.to_string(),
    ]);
    let mut prs_without_a_lift_as_null = Table::new();
    prs_without_a_lift_as_null.set_header(pr_header);
    prs_without_a_lift_as_null.add_row(vec![
        kg(prs.snatch_best),
        kg(prs.cj_best),
        kg(prs.total_best),
    ]);

    let (by_attempt, by_lift) = make_rate_tables(&results.iter().collect::<Vec<_>>());
    Report::new()
        .table("results", meets_table)
        .table_with_data("prs", pr_table, prs_without_a_lift_as_null)
        .table("make_rate_by_attempt", by_attempt)
        .table("make_rate", by_lift)
}

pub fn get_prs(results: &[LiftingResults]) -> PRs {
    results.iter().fold(
        PRs {
            snatch_best: 0.0,
            cj_best: 0.0,
            total_best: 0.0,
        },
        |acc, meet| PRs {
            snatch_best: acc
                .snatch_best
                .max(valid_lift(meet, Lift::Snatch).unwrap_or(0.0)),
            cj_best: acc
                .cj_best
                .max(valid_lift(meet, Lift::CleanAndJerk).unwrap_or(0.0)),
            total_best: acc.total_best.max(valid_total(meet).unwrap_or(0.0)),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::stats::tests::raw_row;

    #[test]
    fn prs_leave_out_source_errors() {
        let real = raw_row([60.0, 63.0, 65.0], [85.0, 90.0, 95.0]);
        let typo = raw_row([-63.0, 633.0, 65.0], [85.0, 90.0, -95.0]);
        let prs = get_prs(&[real, typo]);
        assert_eq!(prs.snatch_best, 65.0);
        assert_eq!(prs.total_best, 160.0);
    }
}
