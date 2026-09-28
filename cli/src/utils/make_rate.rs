use comfy_table::Table;

use crate::types::lifting_results::LiftingResults;

pub fn print_make_rate(vector: &[LiftingResults]) {
    let mut attempt_make_rate = Table::new();

    attempt_make_rate.set_header(vec!["Sn1 Make Rate", "Sn2", "Sn3", "CJ1", "CJ2", "CJ3"]);

    attempt_make_rate.add_row(vec![
        calc_make_rate_by_attempt(vector, "snatch", 1),
        calc_make_rate_by_attempt(vector, "snatch", 2),
        calc_make_rate_by_attempt(vector, "snatch", 3),
        calc_make_rate_by_attempt(vector, "cj", 1),
        calc_make_rate_by_attempt(vector, "cj", 2),
        calc_make_rate_by_attempt(vector, "cj", 3),
    ]);

    println!("{attempt_make_rate}");

    let mut make_rate = Table::new();

    make_rate.set_header(vec!["Snatch Make Rate", "CJ Make Rate", "Total Make Rate"]);

    make_rate.add_row(vec![
        calc_make_rate(vector, "snatch"),
        calc_make_rate(vector, "cj"),
        calc_make_rate(vector, "both"),
    ]);

    println!("{make_rate}");
}

pub fn calc_make_rate(results: &[LiftingResults], lift: &str) -> String {
    let mut count = 0.0;
    let mut made = 0.0;

    for meet in results {
        let attempts = match lift {
            "snatch" => vec![meet.snatch1, meet.snatch2, meet.snatch3],
            "cj" => vec![meet.cj1, meet.cj2, meet.cj3],
            "both" => vec![
                meet.snatch1,
                meet.snatch2,
                meet.snatch3,
                meet.cj1,
                meet.cj2,
                meet.cj3,
            ],
            _ => return "invalid".to_string(),
        };

        for attempt in attempts {
            if attempt >= 0.0 {
                count += 1.0;
                made += 1.0;
            } else {
                count += 1.0
            }
        }
    }

    let percent = (made / count) * 100.0;
    format!("{percent:.2}%")
}

pub fn calc_make_rate_by_attempt(
    results: &[LiftingResults],
    lift: &str,
    attempt_num: u8,
) -> String {
    let mut count = 0.0;
    let mut made = 0.0;

    for meet in results {
        let attempt = match (lift, attempt_num) {
            ("snatch", 1) => meet.snatch1,
            ("snatch", 2) => meet.snatch2,
            ("snatch", 3) => meet.snatch3,
            ("cj", 1) => meet.cj1,
            ("cj", 2) => meet.cj2,
            ("cj", 3) => meet.cj3,
            _ => return "invalid".to_string(),
        };

        if attempt >= 0.0 {
            count += 1.0;
            made += 1.0;
        } else {
            count += 1.0;
        }
    }

    if count == 0.0 {
        return "N/A".to_string();
    }

    let percent = (made / count) * 100.0;
    format!("{percent:.2}%")
}
