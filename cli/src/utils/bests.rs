//! Athletes' best lifts over the past year, as the app's start list shows them.

use std::collections::HashMap;

use anyhow::Result;
use chrono::{Datelike, NaiveDate, Utc};
use serde_json::json;

use crate::types::meets::NamedBests;
use crate::utils::backend::{queries, query};
use crate::utils::format::kg;

/// Names per `results:bests` call (the query takes at most 100).
pub const BESTS_BATCH_SIZE: usize = 100;

/// How far back "year bests" look, as in the app.
pub const YEAR_BESTS_YEARS: i32 = 1;

/// The UTC date `years` before `today`, as the app computes it (29 February falls to 1 March).
pub fn cutoff_date(today: NaiveDate, years: i32) -> String {
    let year = today.year() - years;
    today
        .with_year(year)
        .or_else(|| NaiveDate::from_ymd_opt(year, 3, 1))
        .unwrap_or(today)
        .format("%Y-%m-%d")
        .to_string()
}

/// Each name's best snatch, clean & jerk and total over the past year, keyed by the name as
/// given. Names are read in batches; an empty list reads nothing.
pub async fn year_bests(names: &[String]) -> Result<HashMap<String, NamedBests>> {
    let cutoff = cutoff_date(Utc::now().date_naive(), YEAR_BESTS_YEARS);
    let mut bests = HashMap::new();
    for batch in names.chunks(BESTS_BATCH_SIZE) {
        let rows: Vec<NamedBests> = query(
            queries::BESTS,
            &json!({ "names": batch, "cutoffDate": cutoff }),
        )
        .await?;
        for row in rows {
            bests.insert(row.name.clone(), row);
        }
    }
    Ok(bests)
}

/// `95 / 120 / 215`, blank lifts left blank; empty when there is nothing.
pub fn bests_cell(bests: Option<&NamedBests>) -> String {
    match bests {
        Some(bests) if bests.best_total > 0.0 || bests.best_snatch > 0.0 || bests.best_cj > 0.0 => {
            format!(
                "{} / {} / {}",
                kg(bests.best_snatch),
                kg(bests.best_cj),
                kg(bests.best_total)
            )
        }
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cutoff_is_the_same_day_a_year_earlier() {
        let today = NaiveDate::from_ymd_opt(2026, 9, 28).unwrap();
        assert_eq!(cutoff_date(today, 1), "2025-09-28");
        let leap_day = NaiveDate::from_ymd_opt(2028, 2, 29).unwrap();
        assert_eq!(cutoff_date(leap_day, 1), "2027-03-01");
    }

    #[test]
    fn bests_cells_show_the_three_lifts() {
        let bests = NamedBests {
            name: "Ada".to_string(),
            best_snatch: 95.0,
            best_cj: 120.0,
            best_total: 215.0,
        };
        assert_eq!(bests_cell(Some(&bests)), "95 / 120 / 215");
        let none = NamedBests {
            best_snatch: 0.0,
            best_cj: 0.0,
            best_total: 0.0,
            ..bests
        };
        assert_eq!(bests_cell(Some(&none)), "");
        assert_eq!(bests_cell(None), "");
    }
}
