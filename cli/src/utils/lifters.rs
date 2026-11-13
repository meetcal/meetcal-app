use crate::types::lifting_results::LiftingResults;
use crate::utils::stats::fold;

pub(crate) fn counted_key(row: &LiftingResults) -> String {
    match row.lifter_id.as_deref().or(row.sole_lifter_id.as_deref()) {
        Some(id) => format!("lifter:{id}"),
        None => format!("name:{}", fold(&row.name)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn row(name: &str, lifter: Option<&str>, sole: Option<&str>) -> LiftingResults {
        serde_json::from_value(json!({
            "federation": "USAW", "meet": "Open", "date": "2026-03-01", "name": name, "age": "Open Men's 89kg",
            "body_weight": 88.0, "snatch1": 0.0, "snatch2": 0.0, "snatch3": 0.0, "snatch_best": 130.0,
            "cj1": 0.0, "cj2": 0.0, "cj3": 0.0, "cj_best": 170.0, "total": 300.0, "adaptive": false,
            "lifter_id": lifter, "sole_lifter_id": sole,
        }))
        .expect("a row")
    }

    #[test]
    fn counts_a_row_as_its_lifter_or_the_sole_lifter_it_fits_and_else_by_name() {
        let rows = [
            row("Ada Lee", Some("L1"), None),
            row("ada lee", None, Some("L1")),
            row("Ada Lee", None, None),
            row("John Smith", Some("L2"), None),
            row("John Smith", Some("L3"), None),
            row("John Smith", None, None),
        ];
        let keys: Vec<String> = rows.iter().map(counted_key).collect();
        assert_eq!(
            keys,
            [
                "lifter:L1",
                "lifter:L1",
                "name:ada lee",
                "lifter:L2",
                "lifter:L3",
                "name:john smith"
            ]
        );
    }
}
