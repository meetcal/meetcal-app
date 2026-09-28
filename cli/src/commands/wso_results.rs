use std::collections::{HashMap, HashSet};

use anyhow::{Result, anyhow, bail};
use clap::Parser;
use comfy_table::Table;

use crate::types::athletes::Athletes;
use crate::types::lifting_results::LiftingResults;
use crate::types::wso::{ClubMedalDetail, ClubPrDetail, Movement};
use crate::utils::api::get_api_response_with_query;
use crate::utils::meet_names::{equivalent_meets, result_meet_aliases};

const RESULTS_REQUEST_BATCH_SIZE: usize = 50;

/// Get full meet results for a given WSO.
///
/// Examples:
///   meetcal wso "2026 Masters National Championships & National University Championships" --wso Carolina
#[derive(Parser)]
#[command(name = "wso")]
pub struct WsoResultsArgs {
    /// Meet to search for
    pub meet: String,

    /// WSO to search for
    #[arg(long, short = 'w')]
    pub wso: String,
}

#[derive(Debug, PartialEq)]
pub struct WsoAthletes {
    pub total_athletes: usize,
    pub names: Vec<String>,
}

#[derive(Debug, Default, PartialEq)]
pub struct PerformanceStats {
    pub snatch_attempts: usize,
    pub snatch_makes: usize,
    pub cj_attempts: usize,
    pub cj_makes: usize,
    pub total_weight_lifted: f64,
}

impl PerformanceStats {
    pub fn snatch_make_rate(&self) -> f64 {
        percentage(self.snatch_makes, self.snatch_attempts)
    }

    pub fn cj_make_rate(&self) -> f64 {
        percentage(self.cj_makes, self.cj_attempts)
    }

    pub fn total_make_rate(&self) -> f64 {
        (self.snatch_make_rate() + self.cj_make_rate()) / 2.0
    }
}

#[derive(Debug, Default)]
pub struct PrStats<'a> {
    pub snatch_count: usize,
    pub cj_count: usize,
    pub total_count: usize,
    pub details: Vec<ClubPrDetail>,
    pub target_meet_rows: Vec<&'a LiftingResults>,
    pub missing_names: Vec<String>,
}

pub async fn run(args: WsoResultsArgs) -> Result<()> {
    let athletes = get_wso_athletes(&args.wso, &args.meet).await?;
    let results = get_lifting_results(&athletes.names).await?;
    let pr_stats = calculate_prs(&athletes.names, &results, &args.meet);
    let performance = calculate_performance(&pr_stats.target_meet_rows);
    let meet_results = get_meet_results(&args.meet).await?;
    let medals = calculate_medal_details(&athletes.names, &meet_results);

    println!(
        "{}",
        render_report(
            &args.wso,
            &args.meet,
            athletes.total_athletes,
            athletes.names.len(),
            &performance,
            &pr_stats,
            &medals,
        )
    );

    Ok(())
}

pub async fn get_wso_athletes(wso: &str, meet: &str) -> Result<WsoAthletes> {
    let query_args = [("meet", meet)];
    let athletes: Vec<Athletes> =
        get_api_response_with_query("/meets/athletes", &query_args).await?;

    select_wso_athletes(&athletes, wso, meet)
}

pub fn select_wso_athletes(athletes: &[Athletes], wso: &str, meet: &str) -> Result<WsoAthletes> {
    if athletes.is_empty() {
        bail!("No athletes found for meet \"{meet}\"");
    }

    let normalized_wso = normalize(wso);
    let mut seen_names = HashSet::new();
    let mut names = Vec::new();

    for athlete in athletes {
        if athlete.wso.as_deref().map(normalize).as_deref() != Some(normalized_wso.as_str()) {
            continue;
        }

        let name = athlete.name.trim();
        if !name.is_empty() && seen_names.insert(normalize(name)) {
            names.push(name.to_string());
        }
    }

    if names.is_empty() {
        let mut available_wsos: Vec<_> = athletes
            .iter()
            .filter_map(|athlete| athlete.wso.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect();
        available_wsos.sort_by_key(|value| normalize(value));
        available_wsos.dedup_by(|left, right| normalize(left) == normalize(right));

        let suffix = if available_wsos.is_empty() {
            String::new()
        } else {
            format!(" Available WSOs: {}.", available_wsos.join(", "))
        };

        return Err(anyhow!(
            "No athletes found for WSO \"{wso}\" in meet \"{meet}\".{suffix}"
        ));
    }

    Ok(WsoAthletes {
        total_athletes: athletes.len(),
        names,
    })
}

pub async fn get_lifting_results(
    wso_athlete_names: &[String],
) -> Result<HashMap<String, Vec<LiftingResults>>> {
    if wso_athlete_names.is_empty() {
        return Ok(HashMap::new());
    }

    let mut results: HashMap<String, Vec<LiftingResults>> = HashMap::new();
    for names in wso_athlete_names.chunks(RESULTS_REQUEST_BATCH_SIZE) {
        let query_args = [("names", names.join(","))];
        let lifting_results: Vec<LiftingResults> =
            get_api_response_with_query("/lifting-results/by-names", &query_args).await?;

        for result in lifting_results {
            results
                .entry(normalize(&result.name))
                .or_default()
                .push(result);
        }
    }

    Ok(results)
}

pub async fn get_meet_results(meet: &str) -> Result<Vec<LiftingResults>> {
    let mut results = Vec::new();
    for alias in result_meet_aliases(meet) {
        let query_args = [("meet", alias)];
        let mut rows = get_api_response_with_query("/lifting-results", &query_args).await?;
        results.append(&mut rows);
    }
    Ok(results)
}

pub fn is_pr(current: Option<f64>, previous: Option<f64>) -> bool {
    match (current, previous) {
        (Some(current), Some(previous)) => current > previous,
        (Some(_), None) => true,
        (None, _) => false,
    }
}

pub fn calculate_current_best(
    meets: &[&LiftingResults],
    get: impl Fn(&LiftingResults) -> f64,
) -> Option<f64> {
    meets
        .iter()
        .map(|row| get(row))
        .filter(|value| *value > 0.0 && value.is_finite())
        .max_by(f64::total_cmp)
}

pub fn calculate_prs<'a>(
    wso_athlete_names: &[String],
    results: &'a HashMap<String, Vec<LiftingResults>>,
    meet: &str,
) -> PrStats<'a> {
    let mut stats = PrStats::default();

    for name in wso_athlete_names {
        let history = results
            .get(&normalize(name))
            .map(Vec::as_slice)
            .unwrap_or_default();
        let (current_rows, prior_rows): (Vec<_>, Vec<_>) = history
            .iter()
            .partition(|row| equivalent_meets(meet, &row.meet));

        if current_rows.is_empty() {
            stats.missing_names.push(name.clone());
            continue;
        }

        stats.target_meet_rows.extend(current_rows.iter().copied());

        add_pr(
            &mut stats.snatch_count,
            &mut stats.details,
            name,
            Movement::Snatch,
            calculate_current_best(&current_rows, |row| row.snatch_best),
            calculate_current_best(&prior_rows, |row| row.snatch_best),
        );
        add_pr(
            &mut stats.cj_count,
            &mut stats.details,
            name,
            Movement::CleanAndJerk,
            calculate_current_best(&current_rows, |row| row.cj_best),
            calculate_current_best(&prior_rows, |row| row.cj_best),
        );
        add_pr(
            &mut stats.total_count,
            &mut stats.details,
            name,
            Movement::Total,
            calculate_current_best(&current_rows, |row| row.total),
            calculate_current_best(&prior_rows, |row| row.total),
        );
    }

    stats.details.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then_with(|| left.movement.rank().cmp(&right.movement.rank()))
    });
    stats
}

fn add_pr(
    count: &mut usize,
    details: &mut Vec<ClubPrDetail>,
    name: &str,
    movement: Movement,
    current: Option<f64>,
    previous: Option<f64>,
) {
    if !is_pr(current, previous) {
        return;
    }

    *count += 1;
    details.push(ClubPrDetail {
        name: name.to_string(),
        movement,
        new_pr: current.expect("a PR always has a current result"),
        previous_pr: previous.unwrap_or(0.0),
    });
}

pub fn calculate_performance(rows: &[&LiftingResults]) -> PerformanceStats {
    let mut stats = PerformanceStats::default();

    for row in rows {
        for attempt in [row.snatch1, row.snatch2, row.snatch3] {
            record_attempt(
                attempt,
                &mut stats.snatch_attempts,
                &mut stats.snatch_makes,
                &mut stats.total_weight_lifted,
            );
        }
        for attempt in [row.cj1, row.cj2, row.cj3] {
            record_attempt(
                attempt,
                &mut stats.cj_attempts,
                &mut stats.cj_makes,
                &mut stats.total_weight_lifted,
            );
        }
    }

    stats
}

fn record_attempt(attempt: f64, attempts: &mut usize, makes: &mut usize, volume: &mut f64) {
    if attempt == 0.0 || !attempt.is_finite() {
        return;
    }

    *attempts += 1;
    if attempt > 0.0 {
        *makes += 1;
        *volume += attempt;
    }
}

pub fn calculate_medal_details(
    member_names: &[String],
    meet_rows: &[LiftingResults],
) -> Vec<ClubMedalDetail> {
    let members: HashSet<_> = member_names.iter().map(|name| normalize(name)).collect();
    let mut divisions: HashMap<(String, String), Vec<&LiftingResults>> = HashMap::new();

    for row in meet_rows.iter().filter(|row| row.total > 0.0) {
        divisions
            .entry((normalize(&row.meet), normalize(&row.age)))
            .or_default()
            .push(row);
    }

    let mut details = Vec::new();
    for rows in divisions.values() {
        add_medals(&mut details, &members, rows, Movement::Snatch, |row| {
            row.snatch_best
        });
        add_medals(
            &mut details,
            &members,
            rows,
            Movement::CleanAndJerk,
            |row| row.cj_best,
        );
        add_medals(&mut details, &members, rows, Movement::Total, |row| {
            row.total
        });
    }

    details.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then_with(|| left.movement.rank().cmp(&right.movement.rank()))
            .then_with(|| left.age.cmp(&right.age))
    });
    details
}

fn add_medals(
    details: &mut Vec<ClubMedalDetail>,
    members: &HashSet<String>,
    rows: &[&LiftingResults],
    movement: Movement,
    get_result: impl Fn(&LiftingResults) -> f64,
) {
    let mut rankings: Vec<_> = rows
        .iter()
        .copied()
        .filter(|row| {
            let result = get_result(row);
            result > 0.0 && result.is_finite()
        })
        .collect();
    rankings.sort_by(|left, right| {
        get_result(right)
            .total_cmp(&get_result(left))
            .then_with(|| left.name.cmp(&right.name))
    });

    for (index, row) in rankings.into_iter().take(3).enumerate() {
        if members.contains(&normalize(&row.name)) {
            details.push(ClubMedalDetail {
                name: row.name.clone(),
                age: row.age.clone(),
                movement,
                place: index + 1,
                result: get_result(row),
            });
        }
    }
}

pub fn render_report(
    wso: &str,
    meet: &str,
    total_athletes: usize,
    wso_athletes: usize,
    performance: &PerformanceStats,
    prs: &PrStats<'_>,
    medals: &[ClubMedalDetail],
) -> String {
    let mut athlete_table = Table::new();
    athlete_table.set_header(vec!["Total Athletes", "WSO Athletes"]);
    athlete_table.add_row(vec![total_athletes, wso_athletes]);

    let mut make_rate_table = Table::new();
    make_rate_table.set_header(vec!["Snatch", "CJ", "Total"]);
    make_rate_table.add_row(vec![
        format_percent(performance.snatch_make_rate()),
        format_percent(performance.cj_make_rate()),
        format_percent(performance.total_make_rate()),
    ]);

    let mut volume_table = Table::new();
    volume_table.set_header(vec!["Total Weight Lifted"]);
    volume_table.add_row(vec![format!(
        "{}kg",
        format_weight(performance.total_weight_lifted)
    )]);

    let mut pr_table = Table::new();
    pr_table.set_header(vec!["Snatch PRs", "CJ PRs", "Total PRs"]);
    pr_table.add_row(vec![prs.snatch_count, prs.cj_count, prs.total_count]);

    let mut sections = vec![
        format!("{wso} WSO RESULTS FOR {meet}"),
        athlete_table.to_string(),
        make_rate_table.to_string(),
        volume_table.to_string(),
        pr_table.to_string(),
    ];

    if !prs.details.is_empty() {
        let mut table = Table::new();
        table.set_header(vec!["Athlete", "Movement", "New PR", "Previous PR"]);
        for detail in &prs.details {
            table.add_row(vec![
                detail.name.clone(),
                detail.movement.to_string(),
                format_weight(detail.new_pr),
                format_weight(detail.previous_pr),
            ]);
        }
        sections.push(format!("ATHLETES WITH PRS\n{table}"));
    }

    if !medals.is_empty() {
        let mut table = Table::new();
        table.set_header(vec!["Athlete", "Age", "Movement", "Place", "Result"]);
        for detail in medals {
            table.add_row(vec![
                detail.name.clone(),
                detail.age.clone(),
                detail.movement.to_string(),
                detail.place.to_string(),
                format_weight(detail.result),
            ]);
        }
        sections.push(format!("ATHLETES WITH MEDALS\n{table}"));
    }

    sections.join("\n")
}

fn percentage(made: usize, attempts: usize) -> f64 {
    if attempts == 0 {
        0.0
    } else {
        made as f64 / attempts as f64 * 100.0
    }
}

fn format_percent(value: f64) -> String {
    format!("{value:.2}%")
}

fn format_weight(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        format!("{value:.2}")
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_string()
    }
}

fn normalize(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn athlete(name: &str, wso: Option<&str>) -> Athletes {
        Athletes {
            adaptive: false,
            age: 25.0,
            club: "Club".to_string(),
            entry_total: 200.0,
            gender: "Female".to_string(),
            meet: "Meet".to_string(),
            member_id: "1".to_string(),
            name: name.to_string(),
            session_number: None,
            session_platform: None,
            weight_class: "69".to_string(),
            wso: wso.map(str::to_string),
        }
    }

    fn result(
        name: &str,
        meet: &str,
        age: &str,
        snatch_best: f64,
        cj_best: f64,
        total: f64,
    ) -> LiftingResults {
        LiftingResults {
            federation: "USAW".to_string(),
            meet: meet.to_string(),
            date: "2026-01-01".to_string(),
            name: name.to_string(),
            age: age.to_string(),
            body_weight: 70.0,
            snatch1: snatch_best,
            snatch2: 0.0,
            snatch3: 0.0,
            snatch_best,
            cj1: cj_best,
            cj2: 0.0,
            cj3: 0.0,
            cj_best,
            total,
            adaptive: false,
        }
    }

    #[test]
    fn normalize_ignores_case_and_repeated_whitespace() {
        assert_eq!(normalize("  Mountain   South "), "mountain south");
    }

    #[test]
    fn selects_wso_case_insensitively_and_deduplicates_names() {
        let athletes = vec![
            athlete(" Jane Doe ", Some("Mountain South")),
            athlete("jane   doe", Some(" mountain   south ")),
            athlete("John Doe", Some("Florida")),
        ];

        let selected = select_wso_athletes(&athletes, "MOUNTAIN SOUTH", "Meet").unwrap();

        assert_eq!(selected.total_athletes, 3);
        assert_eq!(selected.names, vec!["Jane Doe"]);
    }

    #[test]
    fn selection_error_lists_available_wsos() {
        let athletes = vec![
            athlete("Jane", Some("Florida")),
            athlete("John", Some("Carolina")),
            athlete("Jess", Some(" florida ")),
        ];

        let error = select_wso_athletes(&athletes, "Ohio", "Meet")
            .unwrap_err()
            .to_string();

        assert!(error.contains("No athletes found for WSO \"Ohio\""));
        assert!(error.contains("Available WSOs: Carolina, Florida"));
    }

    #[test]
    fn selection_distinguishes_empty_meet_from_missing_wso() {
        let error = select_wso_athletes(&[], "Carolina", "Missing Meet")
            .unwrap_err()
            .to_string();

        assert_eq!(error, "No athletes found for meet \"Missing Meet\"");
    }

    #[test]
    fn current_result_without_history_is_a_pr() {
        assert!(is_pr(Some(100.0), None));
    }

    #[test]
    fn missing_current_result_is_not_a_pr() {
        assert!(!is_pr(None, Some(90.0)));
        assert!(!is_pr(None, None));
    }

    #[test]
    fn equal_or_lower_result_is_not_a_pr() {
        assert!(!is_pr(Some(100.0), Some(100.0)));
        assert!(!is_pr(Some(99.0), Some(100.0)));
    }

    #[test]
    fn current_best_ignores_zero_negative_and_non_finite_values() {
        let mut zero = result("A", "Meet", "Open", 0.0, 0.0, 0.0);
        let mut negative = result("A", "Meet", "Open", -90.0, 0.0, 0.0);
        let mut nan = result("A", "Meet", "Open", f64::NAN, 0.0, 0.0);
        let positive = result("A", "Meet", "Open", 95.0, 0.0, 0.0);
        zero.snatch_best = 0.0;
        negative.snatch_best = -90.0;
        nan.snatch_best = f64::NAN;
        let rows = vec![&zero, &negative, &nan, &positive];

        assert_eq!(
            calculate_current_best(&rows, |row| row.snatch_best),
            Some(95.0)
        );
    }

    #[test]
    fn calculate_prs_counts_each_movement_and_sorts_details() {
        let target = "Target Meet";
        let history = HashMap::from([
            (
                normalize("Zed"),
                vec![
                    result("Zed", "Old Meet", "Open", 90.0, 110.0, 200.0),
                    result("Zed", target, "Open", 95.0, 110.0, 205.0),
                ],
            ),
            (
                normalize("Amy"),
                vec![result("Amy", target, "Open", 70.0, 90.0, 160.0)],
            ),
        ]);

        let stats = calculate_prs(&["Zed".into(), "Amy".into()], &history, target);

        assert_eq!(stats.snatch_count, 2);
        assert_eq!(stats.cj_count, 1);
        assert_eq!(stats.total_count, 2);
        assert_eq!(stats.details[0].name, "Amy");
        assert_eq!(stats.details[0].movement, Movement::Snatch);
        assert_eq!(stats.details[3].name, "Zed");
        assert_eq!(stats.details[3].movement, Movement::Snatch);
    }

    #[test]
    fn calculate_prs_matches_names_and_meets_after_normalization() {
        let history = HashMap::from([(
            normalize("Jane Doe"),
            vec![result(
                "JANE DOE",
                " Target   Meet ",
                "Open",
                80.0,
                100.0,
                180.0,
            )],
        )]);

        let stats = calculate_prs(&[" jane   doe ".into()], &history, "target meet");

        assert_eq!(stats.target_meet_rows.len(), 1);
        assert!(stats.missing_names.is_empty());
    }

    #[test]
    fn calculate_prs_uses_split_results_for_combined_masters_and_university_event() {
        let registration =
            "2026 Masters National Championships & National University Championships";
        let history = HashMap::from([(
            normalize("Jane Doe"),
            vec![
                result(
                    "Jane Doe",
                    "2025 State Championships",
                    "Open",
                    75.0,
                    95.0,
                    170.0,
                ),
                result(
                    "Jane Doe",
                    "The 2026 National University Championships",
                    "Open",
                    80.0,
                    100.0,
                    180.0,
                ),
            ],
        )]);

        let stats = calculate_prs(&["Jane Doe".into()], &history, registration);

        assert_eq!(stats.target_meet_rows.len(), 1);
        assert!(stats.missing_names.is_empty());
        assert_eq!(stats.snatch_count, 1);
        assert_eq!(stats.cj_count, 1);
        assert_eq!(stats.total_count, 1);
    }

    #[test]
    fn calculate_prs_reports_names_without_target_results() {
        let history = HashMap::from([(
            normalize("Jane Doe"),
            vec![result("Jane Doe", "Old Meet", "Open", 80.0, 100.0, 180.0)],
        )]);

        let stats = calculate_prs(
            &["Jane Doe".into(), "Missing Athlete".into()],
            &history,
            "Target Meet",
        );

        assert_eq!(
            stats.missing_names,
            vec!["Jane Doe".to_string(), "Missing Athlete".to_string()]
        );
        assert!(stats.target_meet_rows.is_empty());
    }

    #[test]
    fn performance_excludes_unrecorded_attempts_and_counts_misses() {
        let mut row = result("A", "Meet", "Open", 100.0, 120.0, 220.0);
        row.snatch1 = 90.0;
        row.snatch2 = -95.0;
        row.snatch3 = 0.0;
        row.cj1 = 110.0;
        row.cj2 = -115.0;
        row.cj3 = 120.0;

        let stats = calculate_performance(&[&row]);

        assert_eq!(stats.snatch_attempts, 2);
        assert_eq!(stats.snatch_makes, 1);
        assert_eq!(stats.cj_attempts, 3);
        assert_eq!(stats.cj_makes, 2);
        assert_eq!(stats.total_weight_lifted, 320.0);
        assert!((stats.total_make_rate() - 58.333_333).abs() < 0.000_001);
    }

    #[test]
    fn empty_performance_has_zero_rates_instead_of_nan() {
        let stats = calculate_performance(&[]);

        assert_eq!(stats.snatch_make_rate(), 0.0);
        assert_eq!(stats.cj_make_rate(), 0.0);
        assert_eq!(stats.total_make_rate(), 0.0);
    }

    #[test]
    fn medals_are_ranked_within_age_divisions() {
        let rows = vec![
            result("Open One", "Meet", "Open", 100.0, 120.0, 220.0),
            result("Open Two", "Meet", "Open", 95.0, 115.0, 210.0),
            result("Youth One", "Meet", "Youth", 70.0, 90.0, 160.0),
        ];

        let medals = calculate_medal_details(&["Open Two".into(), "Youth One".into()], &rows);

        assert_eq!(medals.len(), 6);
        assert!(medals.iter().all(|medal| medal.place <= 2));
        assert!(
            medals
                .iter()
                .filter(|medal| medal.name == "Youth One")
                .all(|medal| medal.place == 1)
        );
    }

    #[test]
    fn medals_exclude_bomb_out_rows_and_non_members() {
        let rows = vec![
            result("Member", "Meet", "Open", 100.0, 0.0, 0.0),
            result("Other", "Meet", "Open", 90.0, 110.0, 200.0),
        ];

        let medals = calculate_medal_details(&["Member".into()], &rows);

        assert!(medals.is_empty());
    }

    #[test]
    fn medals_only_include_the_top_three_places() {
        let rows = vec![
            result("One", "Meet", "Open", 100.0, 120.0, 220.0),
            result("Two", "Meet", "Open", 95.0, 115.0, 210.0),
            result("Three", "Meet", "Open", 90.0, 110.0, 200.0),
            result("Member", "Meet", "Open", 85.0, 105.0, 190.0),
        ];

        let medals = calculate_medal_details(&["Member".into()], &rows);

        assert!(medals.is_empty());
    }

    #[test]
    fn rendered_report_contains_summary_and_detail_sections() {
        let history = HashMap::from([(
            normalize("Member"),
            vec![result("Member", "Meet", "Open", 100.0, 120.0, 220.0)],
        )]);
        let prs = calculate_prs(&["Member".into()], &history, "Meet");
        let performance = calculate_performance(&prs.target_meet_rows);
        let medals = calculate_medal_details(&["Member".into()], history.values().next().unwrap());

        let report = render_report("Carolina", "Meet", 10, 1, &performance, &prs, &medals);

        assert!(report.contains("Carolina WSO RESULTS FOR Meet"));
        assert!(report.contains("ATHLETES WITH PRS"));
        assert!(report.contains("ATHLETES WITH MEDALS"));
        assert!(report.contains("220kg"));
    }
}
