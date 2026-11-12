use std::collections::{HashMap, HashSet};

use crate::types::athletes::Athletes;
use crate::types::lifting_results::LiftingResults;
use crate::types::wso::{ClubMedalDetail, Movement};
use crate::utils::stats::{Gender, fold, plausible};

pub type RosterClasses = HashMap<String, (String, String)>;

pub fn roster_classes(roster: &[Athletes]) -> RosterClasses {
    let mut sorted: Vec<&Athletes> = roster.iter().collect();
    sorted.sort_by(|a, b| {
        a.name
            .cmp(&b.name)
            .then_with(|| a.weight_class.cmp(&b.weight_class))
            .then_with(|| a.club.cmp(&b.club))
    });
    let mut classes = RosterClasses::new();
    for athlete in sorted {
        classes
            .entry(fold(&athlete.name))
            .or_insert_with(|| (gender_key(&athlete.gender), athlete.weight_class.clone()));
    }
    classes
}

fn gender_key(gender: &str) -> String {
    match Gender::parse(gender) {
        Some(gender) => gender.label().to_lowercase(),
        None => gender.trim().to_lowercase(),
    }
}

fn has_weight_class(age: &str) -> bool {
    let trimmed = age.trim_end();
    let Some(before) = trimmed
        .len()
        .checked_sub(2)
        .filter(|end| trimmed.is_char_boundary(*end))
        .filter(|end| trimmed[*end..].eq_ignore_ascii_case("kg"))
        .map(|end| trimmed[..end].trim_end())
    else {
        return false;
    };
    before
        .strip_suffix('+')
        .unwrap_or(before)
        .ends_with(|c: char| c.is_ascii_digit())
}

pub fn needs_roster(meet_rows: &[LiftingResults]) -> bool {
    meet_rows.iter().any(|row| !has_weight_class(&row.age))
}

fn ranking_group(row: &LiftingResults, roster: &RosterClasses) -> Option<(String, String)> {
    let meet = fold(&row.meet);
    if has_weight_class(&row.age) {
        return Some((meet, fold(&row.age)));
    }
    let (gender, class) = roster.get(&fold(&row.name))?;
    Some((meet, format!("{gender}\u{0}{class}\u{0}{}", fold(&row.age))))
}

pub fn calculate_medal_details(
    member_names: &[String],
    meet_rows: &[LiftingResults],
    roster: &RosterClasses,
) -> Vec<ClubMedalDetail> {
    let members: HashSet<_> = member_names.iter().map(|name| fold(name)).collect();
    let mut divisions: HashMap<(String, String), HashMap<String, &LiftingResults>> = HashMap::new();

    for row in meet_rows.iter().filter(|row| plausible(row)) {
        let Some(group) = ranking_group(row, roster) else {
            continue;
        };
        let best = divisions
            .entry(group)
            .or_default()
            .entry(fold(&row.name))
            .or_insert(row);
        if row.total > best.total || (row.total == best.total && row.date > best.date) {
            *best = row;
        }
    }

    let mut details = Vec::new();
    for athletes in divisions.values() {
        let mut rows: Vec<&LiftingResults> = athletes.values().copied().collect();
        rows.sort_by(|a, b| a.name.cmp(&b.name));
        for movement in [Movement::Snatch, Movement::CleanAndJerk, Movement::Total] {
            let keys: Vec<LiftKey> = rows.iter().map(|row| lift_key(row, movement)).collect();
            for (row, key) in rows.iter().zip(&keys) {
                if !members.contains(&fold(&row.name)) {
                    continue;
                }
                if let Some(place) = place_of(key, &keys).filter(|place| *place <= 3) {
                    details.push(ClubMedalDetail {
                        name: row.name.clone(),
                        age: row.age.clone(),
                        movement,
                        place,
                        result: key[0],
                    });
                }
            }
        }
    }

    details.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then_with(|| left.movement.rank().cmp(&right.movement.rank()))
            .then_with(|| left.age.cmp(&right.age))
    });
    details
}

const BODY_WEIGHT_TIE_BREAK_BEFORE: &str = "2017-01-01";

type LiftKey = Vec<f64>;

fn attempt_of(best: f64, attempts: [f64; 3]) -> f64 {
    match attempts
        .iter()
        .position(|attempt| best > 0.0 && *attempt == best)
    {
        Some(index) => (index + 1) as f64,
        None => 4.0,
    }
}

fn lift_key(row: &LiftingResults, movement: Movement) -> LiftKey {
    let cj_attempt = || attempt_of(row.cj_best, [row.cj1, row.cj2, row.cj3]);
    let (value, bar, attempt) = match movement {
        Movement::Snatch => (
            row.snatch_best,
            row.snatch_best,
            attempt_of(row.snatch_best, [row.snatch1, row.snatch2, row.snatch3]),
        ),
        Movement::CleanAndJerk => (row.cj_best, row.cj_best, cj_attempt()),
        Movement::Total => (row.total, row.cj_best, cj_attempt()),
    };
    if row.date.as_str() >= BODY_WEIGHT_TIE_BREAK_BEFORE {
        return vec![value, bar, attempt];
    }
    let body_weight = if row.body_weight > 0.0 {
        row.body_weight
    } else {
        f64::INFINITY
    };
    vec![value, body_weight, bar, attempt]
}

fn ranks_ahead(a: &LiftKey, b: &LiftKey) -> bool {
    if a[0] != b[0] {
        return a[0] > b[0];
    }
    a.iter()
        .zip(b.iter())
        .skip(1)
        .find(|(x, y)| x != y)
        .is_some_and(|(x, y)| x < y)
}

fn place_of(key: &LiftKey, group: &[LiftKey]) -> Option<usize> {
    if !(key[0] > 0.0 && key[0].is_finite()) {
        return None;
    }
    Some(group.iter().filter(|other| ranks_ahead(other, key)).count() + 1)
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
            date: None,
            weigh_in_time: None,
            start_time: None,
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
        dated(name, meet, "2026-01-01", age, snatch_best, cj_best, total)
    }

    fn dated(
        name: &str,
        meet: &str,
        date: &str,
        age: &str,
        snatch_best: f64,
        cj_best: f64,
        total: f64,
    ) -> LiftingResults {
        LiftingResults {
            federation: "USAW".to_string(),
            meet: meet.to_string(),
            date: date.to_string(),
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
    fn medals_are_ranked_within_age_divisions() {
        let rows = vec![
            result("Open One", "Meet", "Open Men's 89kg", 100.0, 120.0, 220.0),
            result("Open Two", "Meet", "Open Men's 89kg", 95.0, 115.0, 210.0),
            result("Youth One", "Meet", "Youth Men's 61kg", 70.0, 90.0, 160.0),
        ];

        let medals = calculate_medal_details(
            &["Open Two".into(), "Youth One".into()],
            &rows,
            &RosterClasses::new(),
        );

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
    fn a_bomb_out_still_places_in_the_lift_it_made() {
        let rows = vec![
            result("A", "Meet", "Open Men's 89kg", 150.0, 0.0, 0.0),
            result("B", "Meet", "Open Men's 89kg", 145.0, 180.0, 325.0),
            result("C", "Meet", "Open Men's 89kg", 140.0, 175.0, 315.0),
            result("D", "Meet", "Open Men's 89kg", 135.0, 170.0, 305.0),
        ];

        let medals =
            calculate_medal_details(&["A".into(), "D".into()], &rows, &RosterClasses::new());

        let snatch: Vec<_> = medals
            .iter()
            .filter(|medal| medal.movement == Movement::Snatch)
            .map(|medal| (medal.name.as_str(), medal.place))
            .collect();
        assert_eq!(snatch, [("A", 1)]);
        assert!(
            medals
                .iter()
                .filter(|medal| medal.name == "A")
                .all(|medal| medal.movement == Movement::Snatch)
        );
        assert!(
            medals
                .iter()
                .filter(|medal| medal.name == "D")
                .all(|medal| medal.place == 3 && medal.movement != Movement::Snatch)
        );
    }

    #[test]
    fn ties_go_to_the_lighter_bar_then_the_earlier_attempt_then_share() {
        let lift = |name: &str, snatch: [f64; 3], cj: [f64; 3]| {
            let mut row = result(name, "Meet", "Open Men's 89kg", 0.0, 0.0, 0.0);
            row.snatch1 = snatch[0];
            row.snatch2 = snatch[1];
            row.snatch3 = snatch[2];
            row.snatch_best = snatch.iter().copied().fold(0.0, f64::max);
            row.cj1 = cj[0];
            row.cj2 = cj[1];
            row.cj3 = cj[2];
            row.cj_best = cj.iter().copied().fold(0.0, f64::max);
            row.total = row.snatch_best + row.cj_best;
            row
        };
        let rows = vec![
            lift("Zed", [130.0, 0.0, 0.0], [170.0, 0.0, 0.0]),
            lift("Amy", [120.0, 0.0, 0.0], [180.0, 0.0, 0.0]),
            lift("Bo", [120.0, 125.0, 0.0], [100.0, 0.0, 0.0]),
            lift("Cy", [-125.0, 125.0, 0.0], [100.0, 0.0, 0.0]),
        ];
        let names: Vec<String> = ["Zed", "Amy", "Bo", "Cy"].map(String::from).to_vec();

        let medals = calculate_medal_details(&names, &rows, &RosterClasses::new());
        let place = |name: &str, movement: Movement| {
            medals
                .iter()
                .find(|medal| medal.name == name && medal.movement == movement)
                .map(|medal| medal.place)
        };

        assert_eq!(place("Zed", Movement::Total), Some(1));
        assert_eq!(place("Amy", Movement::Total), Some(2));
        assert_eq!(place("Zed", Movement::Snatch), Some(1));
        assert_eq!(place("Bo", Movement::Snatch), Some(2));
        assert_eq!(place("Cy", Movement::Snatch), Some(2));
        assert_eq!(place("Amy", Movement::Snatch), None);
    }

    #[test]
    fn classless_divisions_place_by_roster_class_and_skip_the_unrostered() {
        let rows = vec![
            result("Ada", "Meet", "Open Women", 80.0, 100.0, 180.0),
            result("Bea", "Meet", "Open Women", 85.0, 105.0, 190.0),
            result("Cy", "Meet", "Open Women", 90.0, 110.0, 200.0),
        ];
        let mut ada = athlete("Ada", None);
        ada.weight_class = "58".into();
        let mut bea = athlete("Bea", None);
        bea.weight_class = "71".into();
        let roster = roster_classes(&[ada, bea]);
        assert!(needs_roster(&rows));

        let names: Vec<String> = ["Ada", "Bea", "Cy"].map(String::from).to_vec();
        let medals = calculate_medal_details(&names, &rows, &roster);
        let totals: Vec<_> = medals
            .iter()
            .filter(|medal| medal.movement == Movement::Total)
            .map(|medal| (medal.name.as_str(), medal.place))
            .collect();
        assert_eq!(totals, [("Ada", 1), ("Bea", 1)]);
        assert!(!needs_roster(&[result(
            "Ada",
            "Meet",
            "Open Women's 58 kg",
            1.0,
            1.0,
            2.0
        )]));
        assert!(!needs_roster(&[result(
            "Ada",
            "Meet",
            "Open Women's +87KG",
            1.0,
            1.0,
            2.0
        )]));
    }

    #[test]
    fn an_athlete_places_once_per_division_with_their_best_total() {
        let rows = vec![
            result("Ada", "Meet", "Open Women's 64kg", 100.0, 120.0, 220.0),
            result("ada", "Meet", "Open Women's 64kg", 95.0, 115.0, 210.0),
            result("Bea", "Meet", "Open Women's 64kg", 90.0, 115.0, 205.0),
            result("Cy", "Meet", "Open Women's 64kg", 90.0, 110.0, 200.0),
        ];

        let medals =
            calculate_medal_details(&["Ada".into(), "Cy".into()], &rows, &RosterClasses::new());
        let totals: Vec<_> = medals
            .iter()
            .filter(|medal| medal.movement == Movement::Total)
            .map(|medal| (medal.name.as_str(), medal.place, medal.result))
            .collect();
        assert_eq!(totals, [("Ada", 1, 220.0), ("Cy", 3, 200.0)]);
    }

    #[test]
    fn source_error_rows_take_no_medals() {
        let mut typo = result("Typo", "Meet", "Open Men's 89kg", 633.0, 0.0, 0.0);
        typo.snatch1 = -63.0;
        typo.snatch2 = 633.0;
        typo.snatch3 = 65.0;
        let rows = vec![
            typo,
            result("Ada", "Meet", "Open Men's 89kg", 150.0, 180.0, 330.0),
            result("Bo", "Meet", "Open Men's 89kg", 140.0, 175.0, 315.0),
            result("Cy", "Meet", "Open Men's 89kg", 130.0, 170.0, 300.0),
        ];

        let medals =
            calculate_medal_details(&["Cy".into(), "Typo".into()], &rows, &RosterClasses::new());
        assert!(
            medals
                .iter()
                .all(|medal| medal.name == "Cy" && medal.place == 3)
        );
        assert!(
            medals
                .iter()
                .any(|medal| medal.movement == Movement::Snatch)
        );
    }

    #[test]
    fn medals_exclude_non_members() {
        let rows = vec![
            result("Member", "Meet", "Open Men's 89kg", 0.0, 0.0, 0.0),
            result("Other", "Meet", "Open Men's 89kg", 90.0, 110.0, 200.0),
        ];

        let medals = calculate_medal_details(&["Member".into()], &rows, &RosterClasses::new());

        assert!(medals.is_empty());
    }

    #[test]
    fn medals_only_include_the_top_three_places() {
        let rows = vec![
            result("One", "Meet", "Open Men's 89kg", 100.0, 120.0, 220.0),
            result("Two", "Meet", "Open Men's 89kg", 95.0, 115.0, 210.0),
            result("Three", "Meet", "Open Men's 89kg", 90.0, 110.0, 200.0),
            result("Member", "Meet", "Open Men's 89kg", 85.0, 105.0, 190.0),
        ];

        let medals = calculate_medal_details(&["Member".into()], &rows, &RosterClasses::new());

        assert!(medals.is_empty());
    }
}
