use std::collections::HashSet;

use super::{
    loading::Load,
    models::{Meet, UpcomingMeetsQuery},
};
use crate::utils::api::{queries, query, query_with};

pub(crate) fn load_meet_catalog() -> Load<(), Vec<Meet>> {
    Load::new(
        || (),
        |()| async {
            let (upcoming, completed) = futures::future::join(
                query_with::<Vec<Meet>, _>(queries::UPCOMING_MEETS, &UpcomingMeetsQuery::current()),
                query::<Vec<Meet>>(queries::COMPLETED_MEETS),
            )
            .await;
            match (upcoming, completed) {
                (Ok(upcoming), Ok(completed)) => Ok(meet_catalog(&upcoming, &completed)),
                (Err(error), _) | (_, Err(error)) => Err(error.to_string()),
            }
        },
    )
}

fn meet_catalog(upcoming: &[Meet], completed: &[Meet]) -> Vec<Meet> {
    let mut meets = upcoming
        .iter()
        .chain(completed)
        .cloned()
        .collect::<Vec<_>>();
    meets.sort_by(|left, right| {
        right
            .start_date
            .cmp(&left.start_date)
            .then_with(|| left.name.cmp(&right.name))
    });
    let mut seen = HashSet::new();
    meets.retain(|row| seen.insert(row.name.clone()));
    meets
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meet(name: &str, start_date: &str) -> Meet {
        Meet {
            name: name.to_owned(),
            start_date: start_date.to_owned(),
            end_date: start_date.to_owned(),
            time_zone: "America/Los_Angeles".to_owned(),
            venue_city: String::new(),
            venue_name: String::new(),
            venue_state: String::new(),
            venue_street: String::new(),
            venue_zip: String::new(),
            status: "Published".to_owned(),
            venue_map_pdf_url: None,
            venue_map_apple_url: None,
        }
    }

    #[test]
    fn meet_catalog_is_newest_first_and_deduplicated() {
        let upcoming = [meet("Older", "2026-01-01"), meet("Duplicate", "2026-02-01")];
        let completed = [
            meet("Duplicate", "2025-02-01"),
            meet("Newest", "2026-03-01"),
        ];
        let catalog = meet_catalog(&upcoming, &completed);
        assert_eq!(
            catalog
                .iter()
                .map(|row| row.name.as_str())
                .collect::<Vec<_>>(),
            ["Newest", "Duplicate", "Older"]
        );
    }
}
