use std::collections::{BTreeMap, HashMap, HashSet};

use crate::commands::{
    adaptive_records, attendance, club_results, clubs, compare, elite, group_trends, group_wrapped,
    h2h, intl_rankings, leaderboard, meet, meet_info, meet_results, meets, nat_ranking_year,
    nat_rankings, progress, qual_totals, qualify, records, schedule, search, standards, wrapped,
    wso_records, wsos,
};
use crate::types::club::ClubMeetStats;
use crate::types::meets::Meet;
use crate::types::wrapped::WrappedStats;
use crate::utils::output::Report;
use crate::utils::stats::Gender;
use crate::utils::stats::tests::row;

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/export_keys.json"
);

type Keys = BTreeMap<String, BTreeMap<String, Vec<String>>>;

fn lifter(name: &str) -> crate::types::lifting_results::LiftingResults {
    row(
        name,
        "2026-03-01",
        "Open",
        "Open Women's 71kg",
        70.0,
        [80.0, 0.0, 0.0],
        [100.0, 0.0, 0.0],
    )
}

fn club_meet_stats() -> ClubMeetStats {
    ClubMeetStats {
        total_athletes: 1,
        gold_medals: 0,
        silver_medals: 0,
        bronze_medals: 0,
        total_prs: 0,
        perfect_6_for_6: 0,
        total_weight_lifted: 0.0,
        snatch_make_rate: 0,
        cj_make_rate: 0,
        combined_make_rate: 0,
        athlete_results: Vec::new(),
    }
}

fn a_meet() -> Meet {
    Meet {
        name: "Open".into(),
        federation: "USAW".into(),
        status: "completed".into(),
        start_date: "2026-03-01".into(),
        end_date: "2026-03-01".into(),
        time_zone: "America/New_York".into(),
        venue_name: String::new(),
        venue_street: String::new(),
        venue_city: String::new(),
        venue_state: String::new(),
        venue_zip: String::new(),
        venue_map_pdf_url: None,
        venue_map_apple_url: None,
    }
}

fn elite_lists() -> elite::EliteLists {
    let list = || elite::EliteList {
        method: elite::Method::PercentA,
        men: Vec::new(),
        women: Vec::new(),
    };
    elite::EliteLists {
        overall: list(),
        youth: list(),
        junior: list(),
        senior: list(),
        masters: list(),
    }
}

fn every_commands_report_under_every_flag_that_shapes_it() -> Vec<(&'static str, Report)> {
    let rows = vec![lifter("Ada"), lifter("Bea")];
    let no_stats = WrappedStats::default();
    let no_group = group_wrapped::calculate_group_stats(&[]);
    let edition = |rows| meet_results::EditionSummary {
        meet: "Open".into(),
        year: "2026".into(),
        summary: meet_results::summarize(rows),
    };
    let target = qualify::Target {
        gender: Gender::Women,
        categories: vec!["Senior".into()],
        class: "71".into(),
        retired: None,
    };
    vec![
        ("adaptive-records", adaptive_records::report(&[])),
        ("attendance", attendance::report("open", &[])),
        (
            "club-compare",
            group_wrapped::group_comparison_report("Club", "C", 2025, 2026, &no_group, &no_group),
        ),
        (
            "club-results",
            club_results::report("Club", "C", "Open", &club_meet_stats()),
        ),
        (
            "club-trends",
            group_trends::report("CLUB — C", &rows, &HashSet::new(), Some(&BTreeMap::new())),
        ),
        (
            "club-trends --no-medals",
            group_trends::report("CLUB — C", &rows, &HashSet::new(), None),
        ),
        (
            "club-wrapped",
            group_wrapped::group_wrapped_report("Club", "C", 2026, &no_group),
        ),
        ("clubs", clubs::report(Vec::<String>::new())),
        (
            "compare",
            compare::comparison_report("Ada", 2025, 2026, &no_stats, &no_stats),
        ),
        ("elite", elite::report(&elite_lists())),
        ("h2h", h2h::report(&rows[..1], &rows[1..], "2025-03-01")),
        ("intl-rankings", intl_rankings::report(Vec::new())),
        ("leaderboard", leaderboard::report(&[])),
        ("meet", meet::report(&[], Some(&HashMap::new()))),
        ("meet --no-bests", meet::report(&[], None)),
        ("meet-info", meet_info::report(&a_meet())),
        (
            "meet-results",
            meet_results::report(&rows, &edition(&rows), &[], &[], true),
        ),
        (
            "meet-results --no-history",
            meet_results::report(&rows, &edition(&rows), &[], &[], false),
        ),
        ("meets", meets::report(&[])),
        ("nat-ranking-year", nat_ranking_year::report(Vec::new())),
        ("nat-rankings", nat_rankings::report(Vec::new())),
        ("progress", progress::report("Ada", &rows[..1], None)),
        ("qualifying-totals", qual_totals::report(Vec::new())),
        (
            "qualify",
            qualify::report(&rows[0], &target, (80.0, 100.0, 180.0), &[], &[]),
        ),
        ("records", records::report(&[])),
        ("schedule", schedule::report(&[])),
        ("search", search::report(&rows[..1])),
        ("standards", standards::report(&[])),
        ("wrapped", wrapped::wrapped_report("Ada", 2026, &no_stats)),
        (
            "wso",
            club_results::report("WSO", "W", "Open", &club_meet_stats()),
        ),
        (
            "wso-compare",
            group_wrapped::group_comparison_report("WSO", "W", 2025, 2026, &no_group, &no_group),
        ),
        ("wso-records", wso_records::report(&[])),
        (
            "wso-trends",
            group_trends::report("WSO — W", &rows, &HashSet::new(), Some(&BTreeMap::new())),
        ),
        (
            "wso-trends --no-medals",
            group_trends::report("WSO — W", &rows, &HashSet::new(), None),
        ),
        (
            "wso-wrapped",
            group_wrapped::group_wrapped_report("WSO", "W", 2026, &no_group),
        ),
        ("wsos", wsos::report(&[], &[])),
        ("wsos <WSO>", wsos::age_groups_report(Vec::new())),
    ]
}

fn exported_keys() -> Keys {
    every_commands_report_under_every_flag_that_shapes_it()
        .into_iter()
        .map(|(command, report)| (command.to_string(), report.export_keys()))
        .collect()
}

#[test]
fn every_commands_export_keys_are_the_ones_scripts_were_promised() {
    let keys = exported_keys();
    if std::env::var_os("MEETCAL_UPDATE_FIXTURES").is_some() {
        let text = serde_json::to_string_pretty(&keys).unwrap() + "\n";
        std::fs::write(FIXTURE, text).unwrap();
    }
    let promised: Keys = serde_json::from_str(&std::fs::read_to_string(FIXTURE).unwrap()).unwrap();
    assert_eq!(
        keys, promised,
        "an export key changed: scripts read these. If the change is meant, list it as breaking \
         and regenerate with MEETCAL_UPDATE_FIXTURES=1 cargo test export_keys"
    );
}

#[test]
fn a_flag_never_changes_a_commands_export_keys() {
    let keys = exported_keys();
    for (flagged, plain) in [
        ("club-trends --no-medals", "club-trends"),
        ("wso-trends --no-medals", "wso-trends"),
        ("meet --no-bests", "meet"),
        ("meet-results --no-history", "meet-results"),
    ] {
        assert_eq!(keys[flagged], keys[plain], "{flagged}");
    }
}

#[test]
fn every_command_that_prints_data_is_in_the_snapshot() {
    use clap::CommandFactory;
    let without_data = ["login", "logout", "upgrade"];
    let snapshot: HashSet<String> = exported_keys()
        .into_keys()
        .map(|command| command.split(' ').next().unwrap().to_string())
        .collect();
    for command in crate::parser::Cli::command().get_subcommands() {
        let name = command.get_name();
        assert!(
            snapshot.contains(name) || without_data.contains(&name),
            "{name} has no export keys in the snapshot"
        );
    }
}

#[test]
fn one_quantity_has_one_key_in_every_command() {
    let keys = exported_keys();
    let all: HashSet<&String> = keys
        .values()
        .flat_map(|tables| tables.values())
        .flatten()
        .collect();
    for key in all {
        assert!(
            !key.contains("c_j"),
            "{key} spells clean & jerk a second way"
        );
        assert!(
            !key.contains("2021"),
            "{key} carries the Sinclair coefficients' years"
        );
    }
}
