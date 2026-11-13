use std::collections::HashMap;

use crate::types::lifting_results::LiftingResults;
use crate::utils::stats::fold;

pub(crate) type SoleLifters = HashMap<String, String>;

pub(crate) fn sole_lifters<'a>(rows: impl IntoIterator<Item = &'a LiftingResults>) -> SoleLifters {
    let mut lifters: HashMap<String, Option<String>> = HashMap::new();
    for row in rows {
        let Some(id) = row.lifter_id.as_deref() else {
            continue;
        };
        lifters
            .entry(fold(&row.name))
            .and_modify(|only| {
                if only.as_deref() != Some(id) {
                    *only = None;
                }
            })
            .or_insert_with(|| Some(id.to_owned()));
    }
    lifters
        .into_iter()
        .filter_map(|(name, only)| only.map(|id| (name, id)))
        .collect()
}

pub(crate) fn counted_key(row: &LiftingResults, sole: &SoleLifters) -> String {
    if let Some(id) = row.lifter_id.as_deref() {
        return format!("lifter:{id}");
    }
    let name = fold(&row.name);
    match sole.get(&name) {
        Some(id) => format!("lifter:{id}"),
        None => format!("name:{name}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn row(name: &str, lifter: Option<&str>) -> LiftingResults {
        serde_json::from_value(json!({
            "federation": "USAW", "meet": "Open", "date": "2026-03-01", "name": name, "age": "Open Men's 89kg",
            "body_weight": 88.0, "snatch1": 0.0, "snatch2": 0.0, "snatch3": 0.0, "snatch_best": 130.0,
            "cj1": 0.0, "cj2": 0.0, "cj3": 0.0, "cj_best": 170.0, "total": 300.0, "adaptive": false,
            "lifter_id": lifter,
        }))
        .expect("a row")
    }

    #[test]
    fn counts_a_linked_row_as_its_lifter_and_an_unlinked_one_as_the_names_only_lifter() {
        let rows = [
            row("Ada Lee", Some("L1")),
            row("ada lee", None),
            row("John Smith", Some("L2")),
            row("John Smith", Some("L3")),
            row("John Smith", None),
            row("Bo Day", None),
        ];
        let sole = sole_lifters(&rows);
        let keys: Vec<String> = rows.iter().map(|row| counted_key(row, &sole)).collect();
        assert_eq!(
            keys,
            [
                "lifter:L1",
                "lifter:L1",
                "lifter:L2",
                "lifter:L3",
                "name:john smith",
                "name:bo day"
            ]
        );
    }
}
