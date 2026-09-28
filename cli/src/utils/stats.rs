//! Statistics over lifting results: divisions, Sinclair, attempt habits and PRs.

use std::collections::HashMap;

use crate::types::lifting_results::LiftingResults;

/// Sinclair coefficients (IWF, 2021–2024 cycle; the latest set the IWF has published that we could
/// confirm). A total `t` at bodyweight `bw` scores `t × 10^(A·log10(bw/b)²)` below `b` kg and `t`
/// at or above it.
pub const SINCLAIR_MEN: (f64, f64) = (0.722_762_521, 193.609);
pub const SINCLAIR_WOMEN: (f64, f64) = (0.787_004_341, 153.757);
/// How the Sinclair column is labelled, so output says which coefficients it used.
pub const SINCLAIR_LABEL: &str = "Sinclair (2021-24)";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Gender {
    Men,
    Women,
}

impl Gender {
    pub fn label(self) -> &'static str {
        match self {
            Gender::Men => "Men",
            Gender::Women => "Women",
        }
    }

    /// `Men`/`M`/`male`… or `Women`/`W`/`F`/`female`…
    pub fn parse(value: &str) -> Option<Gender> {
        match value.trim().to_ascii_lowercase().as_str() {
            "men" | "man" | "m" | "male" | "males" => Some(Gender::Men),
            "women" | "woman" | "w" | "f" | "female" | "females" => Some(Gender::Women),
            _ => None,
        }
    }
}

/// A result's division (`Open Men's 89kg`, `Women's Masters (40-44) 69kg`,
/// `Men's 16-17 Age Group 81kg`), parsed.
#[derive(Clone, Debug, PartialEq)]
pub struct Division {
    pub gender: Gender,
    /// The age category standards and qualifying totals use: `Senior`, `Junior`, `U17`, `U15`,
    /// `U13`, `U11` or `Masters 40`; `None` when the division names none we know.
    pub category: Option<String>,
    /// The weight class, `89` or `110+`, without `kg`.
    pub weight_class: Option<String>,
}

impl Division {
    pub fn parse(division: &str) -> Division {
        let lower = division.to_ascii_lowercase();
        let gender = if lower.contains("women") || lower.contains("female") {
            Gender::Women
        } else {
            Gender::Men
        };
        Division {
            gender,
            category: category(&lower),
            weight_class: division.split_whitespace().last().and_then(weight_class),
        }
    }
}

fn category(lower: &str) -> Option<String> {
    if let Some(rest) = lower.split("masters (").nth(1) {
        let start: String = rest.chars().take_while(char::is_ascii_digit).collect();
        return (!start.is_empty()).then(|| format!("Masters {start}"));
    }
    if lower.starts_with("open") || lower.contains(" open ") || lower.contains("senior") {
        return Some("Senior".into());
    }
    if lower.contains("junior") {
        return Some("Junior".into());
    }
    for (marker, label) in [
        ("under 17", "U17"),
        ("under 15", "U15"),
        ("under 13", "U13"),
        ("under 11", "U11"),
        ("under 10", "U11"),
        ("16-17", "U17"),
        ("14-15", "U15"),
        ("13 under", "U13"),
        ("11 under", "U11"),
        ("youth", "U17"),
    ] {
        if lower.contains(marker) {
            return Some(label.into());
        }
    }
    None
}

/// `89kg`, `+110kg`, `110+kg`, `110+` or `89` as `89` / `110+`; `None` for anything else.
pub fn weight_class(value: &str) -> Option<String> {
    let trimmed = value
        .trim()
        .trim_end_matches("kg")
        .trim_end_matches("Kg")
        .trim();
    let plus = trimmed.starts_with('+') || trimmed.ends_with('+');
    let number = trimmed.trim_matches('+');
    if number.is_empty() || !number.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return None;
    }
    Some(if plus {
        format!("{number}+")
    } else {
        number.to_string()
    })
}

/// Bodyweights outside this range are source errors (a handful of rows say 0.9 or 12 kg), not
/// lifters: Sinclair is not computed for them.
pub const PLAUSIBLE_BODY_WEIGHT: std::ops::RangeInclusive<f64> = 15.0..=250.0;

/// A total's Sinclair score at `body_weight`, or `None` without a total or a plausible
/// bodyweight.
pub fn sinclair(total: f64, body_weight: f64, gender: Gender) -> Option<f64> {
    if total <= 0.0 || !total.is_finite() || !PLAUSIBLE_BODY_WEIGHT.contains(&body_weight) {
        return None;
    }
    let (a, b) = match gender {
        Gender::Men => SINCLAIR_MEN,
        Gender::Women => SINCLAIR_WOMEN,
    };
    let coefficient = if body_weight >= b {
        1.0
    } else {
        10f64.powf(a * (body_weight / b).log10().powi(2))
    };
    Some(total * coefficient)
}

/// Q-points (Huebner, Meltzer, Bjarnason and Perperoglou, Med Sci Sports Exerc 2023; the
/// authors' formula file at https://osf.io/8x3nb/): a total `t` at bodyweight `bw` scores
/// `t × Tmax / (β0 + β1·(bw/100)^-2 + β2·(bw/100)^2)`, as `(Tmax, β0, β1, β2)`. USA
/// Weightlifting has used it for best lifters since 2025.
pub const QPOINTS_MEN: (f64, f64, f64, f64) = (463.26, 416.7, -47.87, 18.93);
pub const QPOINTS_WOMEN: (f64, f64, f64, f64) = (306.54, 266.5, -19.44, 18.61);
/// Lighter lifters are scored at these bodyweights: the formula's `(bw/100)^-2` term inflates
/// scores below them (the rule since November 2025, per the Nordic Weightlifting Federation).
pub const QPOINTS_MIN_BODY_WEIGHT_MEN: f64 = 50.0;
pub const QPOINTS_MIN_BODY_WEIGHT_WOMEN: f64 = 41.0;
pub const QPOINTS_LABEL: &str = "Q-points";

/// A total's Q-points at `body_weight`, or `None` without a total or a plausible bodyweight.
pub fn qpoints(total: f64, body_weight: f64, gender: Gender) -> Option<f64> {
    if total <= 0.0 || !total.is_finite() || !PLAUSIBLE_BODY_WEIGHT.contains(&body_weight) {
        return None;
    }
    let ((t_max, b0, b1, b2), floor) = match gender {
        Gender::Men => (QPOINTS_MEN, QPOINTS_MIN_BODY_WEIGHT_MEN),
        Gender::Women => (QPOINTS_WOMEN, QPOINTS_MIN_BODY_WEIGHT_WOMEN),
    };
    let scaled = body_weight.max(floor) / 100.0;
    Some(total * t_max / (b0 + b1 * scaled.powi(-2) + b2 * scaled.powi(2)))
}

/// Whether Q-points apply to a division: juniors, seniors and Masters, not youth (the authors'
/// scope; youth have their own Q-Youth scale).
pub fn qpoints_apply(division: &Division) -> bool {
    !matches!(
        division.category.as_deref(),
        Some("U17" | "U15" | "U13" | "U11")
    )
}

/// A result row's Q-points; `None` for youth divisions and rows whose total is not their snatch
/// plus clean & jerk.
pub fn row_qpoints(row: &LiftingResults) -> Option<f64> {
    let division = Division::parse(&row.age);
    if !consistent_total(row) || !qpoints_apply(&division) {
        return None;
    }
    qpoints(row.total, row.body_weight, division.gender)
}

/// A result row's Sinclair score, from its division's gender; `None` for a row whose total is
/// not its snatch plus clean & jerk.
pub fn row_sinclair(row: &LiftingResults) -> Option<f64> {
    if !consistent_total(row) {
        return None;
    }
    sinclair(row.total, row.body_weight, Division::parse(&row.age).gender)
}

/// Whether a row's total is its best snatch plus best clean & jerk (or it has no total). A few
/// source rows have their columns shifted; leaderboards leave them out.
pub fn consistent_total(row: &LiftingResults) -> bool {
    row.total <= 0.0 || (row.total - (row.snatch_best + row.cj_best)).abs() <= 0.5
}

/// A score to two decimals.
pub fn points(value: Option<f64>) -> String {
    value.map(|value| format!("{value:.2}")).unwrap_or_default()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lift {
    Snatch,
    CleanAndJerk,
}

impl Lift {
    pub fn label(self) -> &'static str {
        match self {
            Lift::Snatch => "Snatch",
            Lift::CleanAndJerk => "C&J",
        }
    }

    pub fn attempts(self, row: &LiftingResults) -> [f64; 3] {
        match self {
            Lift::Snatch => [row.snatch1, row.snatch2, row.snatch3],
            Lift::CleanAndJerk => [row.cj1, row.cj2, row.cj3],
        }
    }

    pub fn best(self, row: &LiftingResults) -> f64 {
        match self {
            Lift::Snatch => row.snatch_best,
            Lift::CleanAndJerk => row.cj_best,
        }
    }
}

/// Whether a result has no total: every attempt in a lift missed (or never taken).
pub fn bombed_out(row: &LiftingResults) -> bool {
    row.snatch_best <= 0.0 || row.cj_best <= 0.0 || row.total <= 0.0
}

/// How a set of results went, attempt by attempt, for one lift.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct AttemptHabits {
    /// Attempts taken and made, by attempt number.
    pub taken: [usize; 3],
    pub made: [usize; 3],
    /// Average kilograms added from the first to the second attempt, and the second to the third,
    /// over results where both were taken.
    pub jump_1_2: Option<f64>,
    pub jump_2_3: Option<f64>,
    /// The average opener as a share of the best made lift, over results with a made lift.
    pub opener_share: Option<f64>,
}

impl AttemptHabits {
    pub fn make_rate(&self, attempt: usize) -> Option<f64> {
        let taken = self.taken[attempt];
        (taken > 0).then(|| self.made[attempt] as f64 * 100.0 / taken as f64)
    }
}

/// Attempt habits for `lift` over `rows`. A missed attempt is recorded as its negative weight
/// and one not taken as 0.
pub fn attempt_habits(rows: &[&LiftingResults], lift: Lift) -> AttemptHabits {
    let mut habits = AttemptHabits::default();
    let (mut jumps_1_2, mut jumps_2_3, mut shares) = (Vec::new(), Vec::new(), Vec::new());
    for row in rows {
        let attempts = lift.attempts(row);
        for (index, attempt) in attempts.iter().enumerate() {
            if *attempt != 0.0 && attempt.is_finite() {
                habits.taken[index] += 1;
                if *attempt > 0.0 {
                    habits.made[index] += 1;
                }
            }
        }
        let weights = attempts.map(f64::abs);
        if weights[0] > 0.0 && weights[1] > 0.0 {
            jumps_1_2.push(weights[1] - weights[0]);
        }
        if weights[1] > 0.0 && weights[2] > 0.0 {
            jumps_2_3.push(weights[2] - weights[1]);
        }
        let best = lift.best(row);
        if best > 0.0 && weights[0] > 0.0 {
            shares.push(weights[0] * 100.0 / best);
        }
    }
    habits.jump_1_2 = average(&jumps_1_2);
    habits.jump_2_3 = average(&jumps_2_3);
    habits.opener_share = average(&shares);
    habits
}

pub fn average(values: &[f64]) -> Option<f64> {
    (!values.is_empty()).then(|| values.iter().sum::<f64>() / values.len() as f64)
}

/// Which lifts of a result were personal records when it was set.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PrFlags {
    pub snatch: bool,
    pub cj: bool,
    pub total: bool,
}

impl PrFlags {
    pub fn any(self) -> bool {
        self.snatch || self.cj || self.total
    }

    /// `S C T` style marks for the lifts that were PRs.
    pub fn marks(self) -> String {
        [(self.snatch, "S"), (self.cj, "CJ"), (self.total, "T")]
            .into_iter()
            .filter_map(|(pr, mark)| pr.then_some(mark))
            .collect::<Vec<_>>()
            .join(" ")
    }
}

/// For each result, oldest first, which lifts beat everything before it. An athlete's first
/// result sets their marks but is not a PR.
pub fn pr_flags(rows: &[&LiftingResults]) -> Vec<PrFlags> {
    let mut best = (0.0f64, 0.0f64, 0.0f64);
    let mut seen = false;
    rows.iter()
        .map(|row| {
            let flags = PrFlags {
                snatch: seen && row.snatch_best > best.0,
                cj: seen && row.cj_best > best.1,
                total: seen && row.total > best.2,
            };
            best = (
                best.0.max(row.snatch_best),
                best.1.max(row.cj_best),
                best.2.max(row.total),
            );
            seen = true;
            flags
        })
        .collect()
}

/// Results oldest first (by date, then meet name).
pub fn chronological(rows: &[LiftingResults]) -> Vec<&LiftingResults> {
    let mut sorted: Vec<&LiftingResults> = rows.iter().collect();
    sorted.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.meet.cmp(&b.meet)));
    sorted
}

/// Lowercase, single-spaced: how names and meets are matched.
pub fn fold(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Rows grouped by athlete (folded name), each group oldest first.
pub fn by_athlete(rows: &[LiftingResults]) -> HashMap<String, Vec<&LiftingResults>> {
    let mut groups: HashMap<String, Vec<&LiftingResults>> = HashMap::new();
    for row in chronological(rows) {
        groups.entry(fold(&row.name)).or_default().push(row);
    }
    groups
}

/// A number without a trailing `.0`.
pub fn number(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        format!("{value:.2}")
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_string()
    }
}

/// A percentage to one decimal, or `N/A`.
pub fn percent(value: Option<f64>) -> String {
    value
        .map(|value| format!("{value:.1}%"))
        .unwrap_or_else(|| "N/A".into())
}

/// Kilograms with a sign, or `N/A`.
pub fn signed_kg(value: Option<f64>) -> String {
    value
        .map(|value| {
            let rounded = (value * 100.0).round() / 100.0;
            let sign = if rounded > 0.0 { "+" } else { "" };
            format!("{sign}{}kg", number(rounded))
        })
        .unwrap_or_else(|| "N/A".into())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn row(
        name: &str,
        date: &str,
        meet: &str,
        age: &str,
        bw: f64,
        snatch: [f64; 3],
        cj: [f64; 3],
    ) -> LiftingResults {
        let best = |lifts: [f64; 3]| lifts.iter().copied().fold(0.0, f64::max);
        let (sb, cb) = (best(snatch), best(cj));
        LiftingResults {
            federation: "USAW".into(),
            meet: meet.into(),
            date: date.into(),
            name: name.into(),
            age: age.into(),
            body_weight: bw,
            snatch1: snatch[0],
            snatch2: snatch[1],
            snatch3: snatch[2],
            snatch_best: sb,
            cj1: cj[0],
            cj2: cj[1],
            cj3: cj[2],
            cj_best: cb,
            total: if sb > 0.0 && cb > 0.0 { sb + cb } else { 0.0 },
            adaptive: false,
        }
    }

    #[test]
    fn parses_divisions() {
        let open = Division::parse("Open Men's 89kg");
        assert_eq!(open.gender, Gender::Men);
        assert_eq!(open.category.as_deref(), Some("Senior"));
        assert_eq!(open.weight_class.as_deref(), Some("89"));
        let masters = Division::parse("Women's Masters (40-44) +87kg");
        assert_eq!(masters.gender, Gender::Women);
        assert_eq!(masters.category.as_deref(), Some("Masters 40"));
        assert_eq!(masters.weight_class.as_deref(), Some("87+"));
        assert_eq!(
            Division::parse("Men's 16-17 Age Group 81kg")
                .category
                .as_deref(),
            Some("U17")
        );
        assert_eq!(
            Division::parse("Women's 13 Under Age Group 40kg")
                .category
                .as_deref(),
            Some("U13")
        );
        assert_eq!(
            Division::parse("Women's Youth Under 15 45Kg")
                .category
                .as_deref(),
            Some("U15")
        );
        assert_eq!(
            Division::parse("Junior Women's 64kg").category.as_deref(),
            Some("Junior")
        );
        assert_eq!(weight_class("110+kg").as_deref(), Some("110+"));
        assert_eq!(weight_class("+110kg").as_deref(), Some("110+"));
        assert_eq!(weight_class("Open"), None);
    }

    #[test]
    fn sinclair_matches_the_formula() {
        // 300 kg at 89 kg bodyweight, men: 300 × 10^(0.722762521 × log10(89/193.609)²).
        let score = sinclair(300.0, 89.0, Gender::Men).unwrap();
        assert!((score - 362.63).abs() < 0.01, "{score}");
        // 200 kg at 64 kg, women.
        let score = sinclair(200.0, 64.0, Gender::Women).unwrap();
        assert!((score - 260.06).abs() < 0.01, "{score}");
        assert_eq!(sinclair(300.0, 200.0, Gender::Men), Some(300.0));
        assert_eq!(sinclair(0.0, 89.0, Gender::Men), None);
        assert_eq!(sinclair(200.0, 0.0, Gender::Women), None);
        // Source errors: impossible bodyweights, and a total that is not the sum of the lifts.
        assert_eq!(sinclair(34.0, 0.9, Gender::Women), None);
        assert_eq!(sinclair(148.0, 12.0, Gender::Men), None);
        let mut shifted = tests::row(
            "A",
            "2025-12-11",
            "M",
            "Open Men's 110kg",
            105.0,
            [127.0, 0.0, 0.0],
            [135.0, 0.0, 0.0],
        );
        shifted.total = 148.0;
        assert!(!consistent_total(&shifted));
        assert_eq!(row_sinclair(&shifted), None);
    }

    #[test]
    fn qpoints_match_the_published_formula() {
        // Men, 300 kg at 89 kg: 300 × 463.26 / (416.7 − 47.87·0.89⁻² + 18.93·0.89²).
        let score = qpoints(300.0, 89.0, Gender::Men).unwrap();
        assert!((score - 374.34).abs() < 0.01, "{score}");
        // Women, 200 kg at 64 kg.
        let score = qpoints(200.0, 64.0, Gender::Women).unwrap();
        assert!((score - 270.48).abs() < 0.01, "{score}");
        // Below the floor, the floor's coefficient.
        assert_eq!(
            qpoints(100.0, 45.0, Gender::Men),
            qpoints(100.0, 50.0, Gender::Men)
        );
        assert_eq!(
            qpoints(100.0, 38.0, Gender::Women),
            qpoints(100.0, 41.0, Gender::Women)
        );
        assert_eq!(qpoints(0.0, 89.0, Gender::Men), None);
        assert_eq!(qpoints(148.0, 12.0, Gender::Men), None);
    }

    #[test]
    fn qpoints_skip_youth_divisions() {
        let senior = tests::row(
            "A",
            "2026-01-01",
            "M",
            "Open Men's 89kg",
            88.0,
            [140.0, 0.0, 0.0],
            [170.0, 0.0, 0.0],
        );
        let masters = tests::row(
            "B",
            "2026-01-01",
            "M",
            "Women's Masters (40-44) 69kg",
            68.0,
            [70.0, 0.0, 0.0],
            [90.0, 0.0, 0.0],
        );
        let youth = tests::row(
            "C",
            "2026-01-01",
            "M",
            "Men's 16-17 Age Group 81kg",
            80.0,
            [110.0, 0.0, 0.0],
            [140.0, 0.0, 0.0],
        );
        assert!(row_qpoints(&senior).is_some());
        assert!(row_qpoints(&masters).is_some());
        assert_eq!(row_qpoints(&youth), None);
        assert!(row_sinclair(&youth).is_some());
    }

    #[test]
    fn attempt_habits_count_makes_jumps_and_openers() {
        let a = row(
            "A",
            "2026-01-01",
            "M1",
            "Open Men's 89kg",
            88.0,
            [100.0, -105.0, 105.0],
            [130.0, 135.0, -140.0],
        );
        let b = row(
            "A",
            "2026-02-01",
            "M2",
            "Open Men's 89kg",
            88.0,
            [102.0, 106.0, 0.0],
            [-132.0, -132.0, -132.0],
        );
        let rows = vec![&a, &b];
        let snatch = attempt_habits(&rows, Lift::Snatch);
        assert_eq!(snatch.taken, [2, 2, 1]);
        assert_eq!(snatch.made, [2, 1, 1]);
        assert_eq!(snatch.jump_1_2, Some(4.5));
        assert_eq!(snatch.jump_2_3, Some(0.0));
        assert_eq!(snatch.make_rate(1), Some(50.0));
        let cj = attempt_habits(&rows, Lift::CleanAndJerk);
        assert_eq!(cj.made, [1, 1, 0]);
        assert!(bombed_out(&b));
        assert!(!bombed_out(&a));
    }

    #[test]
    fn prs_are_lifts_beating_everything_before() {
        let first = row(
            "A",
            "2026-01-01",
            "M1",
            "Open Men's 89kg",
            88.0,
            [100.0, 0.0, 0.0],
            [130.0, 0.0, 0.0],
        );
        let second = row(
            "A",
            "2026-02-01",
            "M2",
            "Open Men's 89kg",
            88.0,
            [105.0, 0.0, 0.0],
            [125.0, 0.0, 0.0],
        );
        let third = row(
            "A",
            "2026-03-01",
            "M3",
            "Open Men's 89kg",
            88.0,
            [101.0, 0.0, 0.0],
            [131.0, 0.0, 0.0],
        );
        let flags = pr_flags(&[&first, &second, &third]);
        assert_eq!(flags[0], PrFlags::default());
        assert_eq!(
            flags[1],
            PrFlags {
                snatch: true,
                cj: false,
                total: false
            }
        );
        assert_eq!(
            flags[2],
            PrFlags {
                snatch: false,
                cj: true,
                total: true
            }
        );
        assert_eq!(flags[2].marks(), "CJ T");
    }

    #[test]
    fn numbers_format_compactly() {
        assert_eq!(number(215.0), "215");
        assert_eq!(number(88.35), "88.35");
        assert_eq!(signed_kg(Some(4.5)), "+4.5kg");
        assert_eq!(percent(None), "N/A");
        assert_eq!(Gender::parse("F"), Some(Gender::Women));
    }
}
