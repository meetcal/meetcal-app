use comfy_table::Table;

use crate::types::lifting_results::LiftingResults;
use crate::utils::stats::{Lift, attempt_habits, percent};

/// Make rates by attempt number, then by lift, as two tables. An attempt recorded as 0 was not
/// taken and is not counted (`stats::attempt_habits`, the server's `makeRatePercent`); with no
/// attempts taken a rate is `N/A`.
pub fn make_rate_tables(results: &[LiftingResults]) -> (Table, Table) {
    let rows: Vec<&LiftingResults> = results.iter().collect();
    let snatch = attempt_habits(&rows, Lift::Snatch);
    let cj = attempt_habits(&rows, Lift::CleanAndJerk);

    let mut by_attempt = Table::new();
    by_attempt.set_header(vec!["Sn1 Make Rate", "Sn2", "Sn3", "CJ1", "CJ2", "CJ3"]);
    by_attempt.add_row(
        [&snatch, &cj]
            .iter()
            .flat_map(|habits| (0..3).map(|attempt| percent(habits.make_rate(attempt))))
            .collect::<Vec<_>>(),
    );

    let rate = |made: usize, taken: usize| (taken > 0).then(|| made as f64 * 100.0 / taken as f64);
    let sum = |counts: [usize; 3]| counts.iter().sum::<usize>();
    let (snatch_made, snatch_taken) = (sum(snatch.made), sum(snatch.taken));
    let (cj_made, cj_taken) = (sum(cj.made), sum(cj.taken));

    let mut by_lift = Table::new();
    by_lift.set_header(vec!["Snatch Make Rate", "CJ Make Rate", "Total Make Rate"]);
    by_lift.add_row(vec![
        percent(rate(snatch_made, snatch_taken)),
        percent(rate(cj_made, cj_taken)),
        percent(rate(snatch_made + cj_made, snatch_taken + cj_taken)),
    ]);

    (by_attempt, by_lift)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::output::Report;
    use crate::utils::stats::tests::row;

    #[test]
    fn untaken_attempts_are_not_makes() {
        let rows = vec![row(
            "A",
            "2026-01-01",
            "M",
            "Open Men's 89kg",
            88.0,
            [100.0, -105.0, 0.0],
            [130.0, 0.0, 0.0],
        )];
        let (by_attempt, by_lift) = make_rate_tables(&rows);
        let json = Report::new()
            .table("by_attempt", by_attempt)
            .table("by_lift", by_lift)
            .to_json();
        assert_eq!(json["by_attempt"][0]["sn2"], 0);
        assert_eq!(json["by_attempt"][0]["sn3"], serde_json::Value::Null);
        assert_eq!(json["by_lift"][0]["snatch_make_rate"], 50);
        assert_eq!(json["by_lift"][0]["total_make_rate"], 66.7);
    }

    #[test]
    fn no_rows_make_no_rate() {
        let (_, by_lift) = make_rate_tables(&[]);
        let json = Report::single("by_lift", by_lift).to_json();
        assert_eq!(json[0]["total_make_rate"], serde_json::Value::Null);
        assert!(
            !Report::single("t", make_rate_tables(&[]).1)
                .to_text()
                .contains("NaN")
        );
    }
}
