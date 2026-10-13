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
    /// Last minus first meet's best total, among meets with a total; `None`
    /// with fewer than two such meets.
    pub improvement: Option<f64>,
    pub longest_streak: usize,
    /// The attempt (1, 2 or 3) made most often; a tie goes to the earlier
    /// attempt, and `None` means nothing was made.
    pub favorite_attempt: Option<usize>,
    pub top_meet: Option<String>,
}

fn meet_key(meet: &str) -> String {
    meet.trim().to_lowercase()
}

fn attempts(row: &LiftResult) -> [f64; 6] {
    [
        row.snatch1,
        row.snatch2,
        row.snatch3,
        row.cj1,
        row.cj2,
        row.cj3,
    ]
}

/// The rows that are distinct lifts, in order: the app's `distinctLifts`
/// (`src/lib/wrapped-stats.ts`).
///
/// One lift can come back as several rows: one meet listed under two age
/// divisions or filed under two dates, or one lift filed under two meet names
/// (Youth and Junior Championships) on one date. Two rows are the same lift
/// when all six attempts and the total are equal and they share the date or
/// the meet name (trimmed, any case); the first is kept.
fn distinct_lifts<'a>(rows: &[&'a LiftResult]) -> Vec<&'a LiftResult> {
    let mut kept: Vec<&LiftResult> = Vec::new();
    for row in rows {
        let duplicate = kept.iter().any(|other| {
            attempts(other) == attempts(row)
                && other.total == row.total
                && (other.date == row.date || meet_key(&other.meet) == meet_key(&row.meet))
        });
        if !duplicate {
            kept.push(row);
        }
    }
    kept
}

/// One athlete's year, scored as the app scores it (`calculateWrappedStats`
/// in `src/lib/wrapped-stats.ts`): rows oldest first, each lift once.
pub(crate) fn wrapped_stats(results: &[LiftResult]) -> WrappedStats {
    let mut ordered = results.iter().collect::<Vec<_>>();
    ordered.sort_by(|left, right| left.date.cmp(&right.date).then(left.meet.cmp(&right.meet)));
    let ordered = distinct_lifts(&ordered);
    let mut stats = WrappedStats::default();
    let mut attempt_count = 0usize;
    let mut makes = 0usize;
    let mut streak = 0usize;
    let mut attempt_makes = [0usize; 3];
    let mut totals = Vec::new();
    // Each meet's best total, in the order the meets first appear.
    let mut meet_totals: Vec<(String, f64)> = Vec::new();
    let mut meets: Vec<String> = Vec::new();

    for row in &ordered {
        for (index, value) in attempts(row).into_iter().enumerate() {
            if value == 0.0 || !value.is_finite() {
                continue;
            }
            attempt_count += 1;
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
        let meet = meet_key(&row.meet);
        if !meets.contains(&meet) {
            meets.push(meet.clone());
        }
        if row.total > 0.0 {
            totals.push(row.total);
            match meet_totals.iter_mut().find(|(name, _)| *name == meet) {
                Some((_, best)) => *best = best.max(row.total),
                None => meet_totals.push((meet, row.total)),
            }
        }
    }

    stats.total_meets = meets.len();
    stats.make_percentage = percentage(makes, attempt_count);
    if !totals.is_empty() {
        stats.average_total = totals.iter().sum::<f64>() / totals.len() as f64;
    }
    // First to last meet with a total, one total per meet (its best): one
    // meet, even listed in two divisions, has nothing to compare.
    if let ([(_, first), ..], [.., (_, last)]) = (meet_totals.as_slice(), meet_totals.as_slice())
        && meet_totals.len() >= 2
    {
        stats.improvement = Some(last - first);
    }
    stats.favorite_attempt = favorite_attempt(attempt_makes);
    // The first meet reaching the best total (as the app picks it).
    stats.top_meet = ordered
        .iter()
        .filter(|row| row.total > 0.0)
        .fold(None::<&&LiftResult>, |best, row| match best {
            Some(best) if best.total >= row.total => Some(best),
            _ => Some(row),
        })
        .map(|row| row.meet.clone());
    stats
}

/// The attempt made most often, the earlier one on a tie; `None` when no
/// attempt was made. The app's `favoriteAttempt` follows the same rule.
fn favorite_attempt(makes: [usize; 3]) -> Option<usize> {
    let mut favorite = None;
    for (index, count) in makes.into_iter().enumerate() {
        if count > 0 && favorite.is_none_or(|(_, best)| count > best) {
            favorite = Some((index, count));
        }
    }
    favorite.map(|(index, _)| index + 1)
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
        result_at(&format!("Meet {date}"), date, total, attempts)
    }

    fn result_at(meet: &str, date: &str, total: f64, attempts: [f64; 6]) -> LiftResult {
        LiftResult {
            meet: meet.to_owned(),
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
        assert_eq!(stats.improvement, Some(15.0));
        assert_eq!(stats.longest_streak, 4);
        assert_eq!(stats.favorite_attempt, Some(1));
    }

    #[test]
    fn a_lift_listed_twice_counts_once() {
        let lift = [61.0, -64.0, -64.0, 81.0, -84.0, -87.0];
        let stats = wrapped_stats(&[
            // One meet filed under two dates.
            result_at("Summer Slam", "2026-05-16", 142.0, lift),
            result_at("Summer Slam", "2026-05-19", 142.0, lift),
            // One lift filed under two meets on one date.
            result_at("Youth Championships", "2026-06-28", 142.0, lift),
            result_at("Junior Championships", "2026-06-28", 142.0, lift),
        ]);
        // Two distinct lifts: Summer Slam and the championships.
        assert_eq!(stats.total_weight_lifted, 2.0 * 142.0);
        assert_eq!(stats.make_percentage, percentage(4, 12));
        assert_eq!(stats.average_total, 142.0);
        assert_eq!(stats.total_meets, 2);
        assert_eq!(stats.improvement, Some(0.0));
    }

    #[test]
    fn the_same_numbers_at_another_meet_and_date_are_another_lift() {
        let lift = [90.0, 95.0, 0.0, 110.0, 115.0, 0.0];
        let stats = wrapped_stats(&[
            result_at("Winter Open", "2026-01-10", 210.0, lift),
            result_at("Spring Open", "2026-04-10", 210.0, lift),
        ]);
        assert_eq!(stats.total_weight_lifted, 2.0 * 410.0);
        assert_eq!(stats.total_meets, 2);
    }

    #[test]
    fn one_meet_has_no_first_to_last_change() {
        let lift = [90.0, 95.0, 0.0, 110.0, 115.0, 0.0];
        // One meet, listed in two divisions with different numbers.
        let stats = wrapped_stats(&[
            result_at("Open", "2026-03-01", 210.0, lift),
            result_at(
                "Open",
                "2026-03-01",
                205.0,
                [90.0, 95.0, 0.0, 110.0, -115.0, 0.0],
            ),
        ]);
        assert_eq!(stats.improvement, None);
        assert_eq!(wrapped_stats(&[]).improvement, None);
    }

    #[test]
    fn first_to_last_uses_each_meets_best_total_and_skips_bomb_outs() {
        let lift = [90.0, 95.0, 0.0, 110.0, 115.0, 0.0];
        let stats = wrapped_stats(&[
            result_at(
                "Winter Open",
                "2026-01-10",
                0.0,
                [-90.0, -90.0, -90.0, 0.0, 0.0, 0.0],
            ),
            result_at("Spring Open", "2026-04-10", 200.0, lift),
            result_at(
                "Spring Open",
                "2026-04-10",
                205.0,
                [90.0, 95.0, 0.0, 110.0, 120.0, 0.0],
            ),
            result_at(
                "Fall Open",
                "2026-09-10",
                195.0,
                [90.0, 95.0, 0.0, 100.0, 0.0, 0.0],
            ),
        ]);
        assert_eq!(stats.improvement, Some(-10.0));
    }

    #[test]
    fn favorite_attempt_ties_go_to_the_earlier_attempt_and_none_is_none() {
        assert_eq!(favorite_attempt([6, 6, 2]), Some(1));
        assert_eq!(favorite_attempt([1, 3, 3]), Some(2));
        assert_eq!(favorite_attempt([0, 0, 1]), Some(3));
        assert_eq!(favorite_attempt([0, 0, 0]), None);
    }
}
