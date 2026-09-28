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
    normalized
        .split_whitespace()
        .find(|token| token.len() == 4 && token.bytes().all(|byte| byte.is_ascii_digit()))
}

fn normalize(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_alphanumeric() {
                character.to_ascii_lowercase()
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
