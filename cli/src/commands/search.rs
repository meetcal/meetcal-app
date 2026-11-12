use crate::{
    types::lifting_results::{LiftingResults, PRs, PrMarks},
    utils::{
        athletes::{LifterPick, history},
        format::kg,
        make_rate::make_rate_tables,
        output::{self, Report},
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

    #[command(flatten)]
    pub pick: LifterPick,
}

pub async fn run(args: SearchArgs) -> Result<()> {
    let history = history(&args.name, &args.pick).await?;
    output::emit(report(&history.rows, &history.prs));
    Ok(())
}

pub(crate) fn report(results: &[LiftingResults], prs: &PrMarks) -> Report {
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

    let prs = get_prs(results, prs);
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

pub(crate) fn get_prs(results: &[LiftingResults], prs: &PrMarks) -> PRs {
    let at = |index: Option<usize>, lift: fn(&LiftingResults) -> f64| {
        index.and_then(|index| results.get(index)).map_or(0.0, lift)
    };
    PRs {
        snatch_best: at(prs.current.snatch, |row| row.snatch_best),
        cj_best: at(prs.current.cj, |row| row.cj_best),
        total_best: at(prs.current.total, |row| row.total),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::lifting_results::ByLift;
    use crate::utils::stats::tests::raw_row;

    fn current(snatch: Option<usize>, cj: Option<usize>, total: Option<usize>) -> PrMarks {
        PrMarks {
            current: ByLift { snatch, cj, total },
            ..PrMarks::default()
        }
    }

    #[test]
    fn a_lift_never_made_exports_null_and_still_shows_zero() {
        let bombed_every_snatch = raw_row([-60.0, -60.0, -60.0], [85.0, 0.0, 0.0]);
        let report = report(&[bombed_every_snatch], &current(None, Some(0), None));
        let prs = &report.to_json()["prs"][0];
        assert_eq!(prs["snatch_pr"], serde_json::Value::Null);
        assert_eq!(prs["total_pr"], serde_json::Value::Null);
        assert_eq!(prs["cj_pr"], 85);
        assert!(report.to_text().contains("| 0 "));
    }

    #[test]
    fn prs_are_the_lifts_of_the_results_the_server_marks_current() {
        let real = raw_row([60.0, 63.0, 65.0], [85.0, 90.0, 95.0]);
        let typo = raw_row([-63.0, 633.0, 65.0], [85.0, 90.0, -95.0]);
        let prs = get_prs(&[real, typo], &current(Some(0), Some(0), Some(0)));
        assert_eq!(prs.snatch_best, 65.0);
        assert_eq!(prs.total_best, 160.0);
        assert_eq!(get_prs(&[], &current(Some(3), None, None)).snatch_best, 0.0);
    }
}
