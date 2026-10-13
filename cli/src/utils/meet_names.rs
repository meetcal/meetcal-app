use std::collections::BTreeMap;

use crate::types::lifting_results::LiftingResults;
use crate::utils::stats::fold;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum NationalEvent {
    NationalChampionships,
    MastersAndUniversity,
}

/// Returns true when a registration/start-list meet and a results meet describe the same event.
///
/// USA Weightlifting publishes some national-week start lists under a combined event name while
/// publishing results under the individual championships. Keep that intentionally narrow so a
/// registration at one national event is never attributed to a different national event.
pub fn equivalent_meets(registration_meet: &str, result_meet: &str) -> bool {
    let registration = normalize(registration_meet);
    let result = normalize(result_meet);

    if registration == result {
        return true;
    }

    let Some(year) = meet_year(&registration) else {
        return false;
    };
    if meet_year(&result) != Some(year) {
        return false;
    }

    match national_event(&registration) {
        Some(NationalEvent::NationalChampionships) => is_national_championships_result(&result),
        Some(NationalEvent::MastersAndUniversity) => is_masters_or_university_result(&result),
        None => false,
    }
}

/// Exact result-meet names to request for a registration/start-list event.
pub fn result_meet_aliases(meet: &str) -> Vec<String> {
    let mut aliases = vec![meet.to_string()];
    let normalized = normalize(meet);
    let Some(year) = meet_year(&normalized) else {
        return aliases;
    };

    match national_event(&normalized) {
        Some(NationalEvent::NationalChampionships) => {
            aliases.push(format!(
                "The {year} National Junior Championships, Powered by Rogue Fitness"
            ));
            aliases.push(format!(
                "The {year} National Youth Championships, Powered by Rogue Fitness"
            ));
        }
        Some(NationalEvent::MastersAndUniversity) => {
            aliases.push(format!(
                "The {year} USA Weightlifting Masters National Championships Powered by Rogue Fitness"
            ));
            aliases.push(format!("The {year} National University Championships"));
        }
        None => {}
    }

    aliases
}

/// Words sponsors add to a meet's name one year and drop the next ("The 2024 Nike USA
/// Weightlifting National Championships").
pub const SPONSOR_WORDS: &[&str] = &["nike"];

/// What stays the same across a meet's editions: its name's words, lowercase, without the year,
/// "The", punctuation, sponsor words, or a trailing "powered by …", "presented by …" or
/// "sponsored by …". `The 2025 DMV WSO Championships` and `2024 DMV WSO Championships` share
/// one; so do `2025 USA Weightlifting National Championships, Powered by Rogue Fitness` and
/// `The 2024 Nike USA Weightlifting National Championships, powered by Rogue`.
pub fn series_name(meet: &str) -> String {
    let normalized = normalize(meet);
    let words: Vec<&str> = normalized.split_whitespace().collect();
    let mut kept = Vec::new();
    for (index, word) in words.iter().enumerate() {
        if matches!(*word, "powered" | "presented" | "sponsored")
            && words.get(index + 1) == Some(&"by")
        {
            break;
        }
        if *word == "the" || is_year(word) || SPONSOR_WORDS.contains(word) {
            continue;
        }
        kept.push(*word);
    }
    kept.join(" ")
}

/// A result's year, the first four characters of its `YYYY-MM-DD` date.
pub fn result_year(row: &LiftingResults) -> String {
    row.date.get(..4).unwrap_or(&row.date).to_string()
}

/// A meet's results split into editions by year, oldest first. Many meets keep one name every
/// year (`Testify Leprechaun Lift-off`), and `results:byMeet` answers every edition's rows for
/// it, so a meet name alone is not one event.
pub fn editions_by_year(rows: Vec<LiftingResults>) -> BTreeMap<String, Vec<LiftingResults>> {
    let mut years: BTreeMap<String, Vec<LiftingResults>> = BTreeMap::new();
    for row in rows {
        years.entry(result_year(&row)).or_default().push(row);
    }
    years
}

fn is_year(word: &str) -> bool {
    word.len() == 4 && word.bytes().all(|byte| byte.is_ascii_digit())
}

fn national_event(normalized: &str) -> Option<NationalEvent> {
    if normalized.contains("masters national championships")
        && normalized.contains("national university championships")
    {
        Some(NationalEvent::MastersAndUniversity)
    } else if normalized.contains("usa weightlifting national championships") {
        Some(NationalEvent::NationalChampionships)
    } else {
        None
    }
}

fn is_national_championships_result(normalized: &str) -> bool {
    normalized.contains("usa weightlifting national championships")
        || normalized.contains("national junior championships")
        || normalized.contains("national youth championships")
}

fn is_masters_or_university_result(normalized: &str) -> bool {
    normalized.contains("weightlifting masters national championships")
        || normalized.contains("national university championships")
}

fn meet_year(normalized: &str) -> Option<&str> {
    normalized.split_whitespace().find(|token| is_year(token))
}

/// [`fold`] (Unicode NFC and lowercase, so a composed "é" and an "e" with a combining accent are
/// one letter), then punctuation and spacing reduced to single spaces.
fn normalize(value: &str) -> String {
    fold(value)
        .chars()
        .map(|character| {
            if character.is_alphanumeric() {
                character
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_names_ignore_case_whitespace_and_punctuation() {
        assert!(equivalent_meets(
            "2026 VIRUS Weightlifting Series 1",
            " 2026 Virus Weightlifting Series 1 "
        ));
        assert!(equivalent_meets("BrewCity Open 11.", "BrewCity Open 11"));
    }

    #[test]
    fn national_week_registration_matches_split_junior_and_youth_results() {
        let registration =
            "2026 USA Weightlifting National Championships, Powered by Rogue Fitness";

        assert!(equivalent_meets(
            registration,
            "The 2026 National Junior Championships, Powered by Rogue Fitness"
        ));
        assert!(equivalent_meets(
            registration,
            "The 2026 National Youth Championships, Powered by Rogue Fitness"
        ));
    }

    #[test]
    fn masters_and_university_registration_matches_both_result_meets() {
        let registration =
            "2026 Masters National Championships & National University Championships";

        assert!(equivalent_meets(
            registration,
            "The 2026 USA Weightlifting Masters National Championships Powered by Rogue Fitness"
        ));
        assert!(equivalent_meets(
            registration,
            "The 2026 National University Championships"
        ));
    }

    #[test]
    fn national_event_families_and_years_do_not_leak_into_each_other() {
        let nationals = "2026 USA Weightlifting National Championships, Powered by Rogue Fitness";
        let masters = "2026 Masters National Championships & National University Championships";

        assert!(!equivalent_meets(
            nationals,
            "The 2026 National University Championships"
        ));
        assert!(!equivalent_meets(
            masters,
            "The 2026 National Junior Championships, Powered by Rogue Fitness"
        ));
        assert!(!equivalent_meets(
            nationals,
            "The 2025 National Junior Championships, Powered by Rogue Fitness"
        ));
    }

    #[test]
    fn series_names_ignore_the_year_the_and_sponsors() {
        assert_eq!(
            series_name("The 2025 DMV WSO Championships"),
            series_name("2024 DMV WSO Championships")
        );
        assert_eq!(
            series_name("2025 Indiana WSO Championship"),
            series_name("Indiana WSO Championship 2024")
        );
        assert_eq!(
            series_name("The 2025 Gator Weightlifting Winter Open (NUQ)"),
            series_name("The Gator Weightlifting Winter Open 2024 (NUQ)")
        );
        assert_eq!(
            series_name("2025 USA Weightlifting National Championships, Powered by Rogue Fitness"),
            "usa weightlifting national championships"
        );
        assert_eq!(
            series_name("The 2024 Nike USA Weightlifting National Championships, powered by Rogue"),
            "usa weightlifting national championships"
        );
        assert_ne!(
            series_name("2023 DMV WSO Championships and Fall Brawl"),
            series_name("2024 DMV WSO Championships")
        );
    }

    #[test]
    fn composed_and_decomposed_accents_are_one_series() {
        assert_eq!(
            series_name("2025 Café Open"),
            series_name("2024 Cafe\u{301} Open")
        );
        assert_eq!(series_name("2025 CAFÉ OPEN"), "café open");
        assert!(equivalent_meets("2025 Café Open", "2025 Cafe\u{301} open"));
    }

    #[test]
    fn one_meet_name_splits_into_editions_by_year() {
        use crate::utils::stats::tests::row;
        let lift = |name: &str, date: &str| {
            row(
                name,
                date,
                "Testify Leprechaun Lift-off",
                "Open Men's 89kg",
                88.0,
                [100.0, 0.0, 0.0],
                [120.0, 0.0, 0.0],
            )
        };
        let years = editions_by_year(vec![
            lift("A", "2024-03-16"),
            lift("B", "2018-03-10"),
            lift("C", "2024-03-16"),
        ]);
        assert_eq!(years.keys().collect::<Vec<_>>(), ["2018", "2024"]);
        assert_eq!(years["2024"].len(), 2);
    }

    #[test]
    fn aliases_include_the_exact_meet_and_only_its_split_event_names() {
        let meet = "2026 Masters National Championships & National University Championships";
        let aliases = result_meet_aliases(meet);

        assert_eq!(aliases.len(), 3);
        assert_eq!(aliases[0], meet);
        assert!(
            aliases
                .iter()
                .any(|alias| alias.contains("Masters National"))
        );
        assert!(
            aliases
                .iter()
                .any(|alias| alias.contains("National University"))
        );
        assert!(!aliases.iter().any(|alias| alias.contains("Junior")));
    }
}
