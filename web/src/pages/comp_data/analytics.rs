use std::collections::HashSet;

use super::models::LiftResult;

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct WrappedStats {
    pub total_weight_lifted: f64,
    pub total_meets: usize,
    pub make_percentage: f64,
    pub best_snatch: f64,
    pub best_cj: f64,
    pub best_total: f64,
    pub average_total: f64,
    pub improvement: f64,
    pub longest_streak: usize,
    pub favorite_attempt: Option<usize>,
    pub top_meet: Option<String>,
}

pub(crate) fn wrapped_stats(results: &[LiftResult]) -> WrappedStats {
    let mut ordered = results.iter().collect::<Vec<_>>();
    ordered.sort_by(|left, right| left.date.cmp(&right.date).then(left.meet.cmp(&right.meet)));
    let mut stats = WrappedStats::default();
    let mut attempts = 0usize;
    let mut makes = 0usize;
    let mut streak = 0usize;
    let mut attempt_makes = [0usize; 3];
    let mut totals = Vec::new();

    for row in &ordered {
        for (index, value) in [
            row.snatch1,
            row.snatch2,
            row.snatch3,
            row.cj1,
            row.cj2,
            row.cj3,
        ]
        .into_iter()
        .enumerate()
        {
            if value == 0.0 || !value.is_finite() {
                continue;
            }
            attempts += 1;
            if value > 0.0 {
                makes += 1;
                stats.total_weight_lifted += value;
                streak += 1;
                stats.longest_streak = stats.longest_streak.max(streak);
                attempt_makes[index % 3] += 1;
            } else {
                streak = 0;
            }
        }
        stats.best_snatch = stats.best_snatch.max(row.snatch_best.max(0.0));
        stats.best_cj = stats.best_cj.max(row.cj_best.max(0.0));
        stats.best_total = stats.best_total.max(row.total.max(0.0));
        if row.total > 0.0 {
            totals.push(row.total);
        }
    }

    stats.total_meets = ordered
        .iter()
        .map(|row| row.meet.trim().to_lowercase())
        .collect::<HashSet<_>>()
        .len();
    stats.make_percentage = percentage(makes, attempts);
    if !totals.is_empty() {
        stats.average_total = totals.iter().sum::<f64>() / totals.len() as f64;
        stats.improvement = totals.last().unwrap_or(&0.0) - totals.first().unwrap_or(&0.0);
    }
    stats.favorite_attempt = attempt_makes
        .iter()
        .enumerate()
        .filter(|(_, count)| **count > 0)
        .max_by(|(left_index, left), (right_index, right)| {
            left.cmp(right).then(right_index.cmp(left_index))
        })
        .map(|(index, _)| index + 1);
    stats.top_meet = ordered
        .iter()
        .filter(|row| row.total > 0.0)
        .max_by(|left, right| left.total.total_cmp(&right.total))
        .map(|row| row.meet.clone());
    stats
}

pub(crate) fn percentage(makes: usize, attempts: usize) -> f64 {
    if attempts == 0 {
        0.0
    } else {
        makes as f64 / attempts as f64 * 100.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn result(date: &str, total: f64, attempts: [f64; 6]) -> LiftResult {
        LiftResult {
            meet: format!("Meet {date}"),
            date: date.to_owned(),
            age: "Senior".to_owned(),
            body_weight: 70.0,
            snatch1: attempts[0],
            snatch2: attempts[1],
            snatch3: attempts[2],
            snatch_best: 100.0,
            cj1: attempts[3],
            cj2: attempts[4],
            cj3: attempts[5],
            cj_best: 125.0,
            total,
            adaptive: false,
        }
    }

    #[test]
    fn wrapped_matches_cli_attempt_and_progress_rules() {
        let stats = wrapped_stats(&[
            result(
                "2026-01-01",
                210.0,
                [90.0, -95.0, 95.0, 110.0, 115.0, -120.0],
            ),
            result("2026-06-01", 225.0, [95.0, 100.0, 0.0, 120.0, 125.0, 0.0]),
        ]);
        assert_eq!(stats.total_meets, 2);
        assert_eq!(stats.make_percentage, 80.0);
        assert_eq!(stats.improvement, 15.0);
        assert_eq!(stats.longest_streak, 4);
        assert_eq!(stats.favorite_attempt, Some(1));
    }
}
