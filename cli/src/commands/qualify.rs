use anyhow::{Result, bail};
use clap::Parser;
use comfy_table::Table;
use serde::Deserialize;

use crate::utils::athletes::history;
use crate::utils::backend::{NoArgs, queries, query};
use crate::utils::bests::year_bests;
use crate::utils::output::{self, Report};
use crate::utils::stats::{Division, Gender, chronological, number, weight_class};

/// Show how far an athlete's best lifts over the past year are from the USAW A/B standards and
/// each event's qualifying total in their class.
///
/// The athlete's gender, age category and weight class come from their latest result; override
/// them with --category and --class.
///
/// Examples:
///   meetcal qualify "Brandon Victorian"
///   meetcal qualify "Brandon Victorian" --class 94
#[derive(Parser)]
#[command(name = "qualify")]
pub struct QualifyArgs {
    /// Exact athlete name
    pub name: String,

    /// Weight class to check, e.g. 89 or 110+ (defaults to the latest result's)
    #[arg(long, short = 'c')]
    pub class: Option<String>,

    /// Age category to check, e.g. Senior, Junior, U17, U15 or Masters 40 (defaults to the latest
    /// result's; Senior standards are always shown too)
    #[arg(long, short = 'a')]
    pub category: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Standard {
    pub age_category: String,
    pub gender: String,
    pub weight_class: String,
    pub standard_a: f64,
    pub standard_b: f64,
}

#[derive(Debug, Deserialize)]
pub struct QualifyingTotal {
    pub event_name: String,
    pub gender: String,
    pub age_category: String,
    pub weight_class: String,
    pub qualifying_total: f64,
}

/// Who is being checked: gender, the age categories, and the class.
#[derive(Debug, PartialEq)]
pub struct Target {
    pub gender: Gender,
    pub categories: Vec<String>,
    pub class: String,
}

pub async fn run(args: QualifyArgs) -> Result<()> {
    let rows = history(&args.name).await?;
    let latest = chronological(&rows)
        .last()
        .copied()
        .expect("history is never empty");
    let name = latest.name.clone();
    let division = Division::parse(&latest.age);
    let target = target(&division, args.category.as_deref(), args.class.as_deref())?;

    let bests = year_bests(std::slice::from_ref(&name)).await?;
    let best = bests.get(&name);
    let (snatch, cj, total) = best
        .map(|b| (b.best_snatch, b.best_cj, b.best_total))
        .unwrap_or_default();

    let standards: Vec<Standard> = query(queries::STANDARDS, &NoArgs {}).await?;
    let totals: Vec<QualifyingTotal> = query(queries::QUALIFYING_TOTALS, &NoArgs {}).await?;

    let mut athlete = Table::new();
    athlete.set_header(vec![
        "Athlete",
        "Latest Division",
        "Checked As",
        "Past-Year Snatch",
        "Past-Year C&J",
        "Past-Year Total",
    ]);
    athlete.add_row(vec![
        name.clone(),
        latest.age.clone(),
        format!(
            "{} {} {}kg",
            target.gender.label(),
            target.categories.join(" / "),
            target.class
        ),
        number(snatch),
        number(cj),
        number(total),
    ]);

    output::emit(
        Report::new()
            .titled(format!("QUALIFYING — {name}"))
            .table("athlete", athlete)
            .headed(
                "standards",
                "USAW A/B STANDARDS",
                standards_table(&standards, &target, total),
            )
            .headed(
                "qualifying_totals",
                "QUALIFYING TOTALS",
                totals_table(&totals, &target, total),
            ),
    );
    Ok(())
}

/// The categories and class to check: the overrides, or what `division` says.
pub fn target(division: &Division, category: Option<&str>, class: Option<&str>) -> Result<Target> {
    let class = match class {
        Some(class) => match weight_class(class) {
            Some(class) => class,
            None => bail!("Weight class must look like 89 or 110+, not \"{class}\""),
        },
        None => match &division.weight_class {
            Some(class) => class.clone(),
            None => bail!("Could not tell the weight class from the latest result; pass --class"),
        },
    };
    let primary = category
        .map(str::to_string)
        .or_else(|| division.category.clone());
    let mut categories: Vec<String> = primary.into_iter().collect();
    if !categories.iter().any(|c| c.eq_ignore_ascii_case("Senior")) {
        categories.push("Senior".into());
    }
    Ok(Target {
        gender: division.gender,
        categories,
        class,
    })
}

/// The standards tables name the 16-17 category "Youth".
fn standards_category(category: &str) -> &str {
    if category.eq_ignore_ascii_case("U17") {
        "Youth"
    } else {
        category
    }
}

fn gap_cells(needed: f64, best: f64) -> (String, String) {
    if needed <= 0.0 {
        return ("—".into(), "No standard".into());
    }
    let gap = needed - best;
    if gap <= 0.0 {
        (number(needed), "Met".into())
    } else {
        (number(needed), format!("{} to go", number(gap)))
    }
}

pub fn standards_table(standards: &[Standard], target: &Target, total: f64) -> Table {
    let mut table = Table::new();
    table.set_header(vec!["Category", "Level", "Needed Total", "Status"]);
    for category in &target.categories {
        let wanted = standards_category(category);
        let Some(standard) = standards.iter().find(|s| {
            s.age_category.eq_ignore_ascii_case(wanted)
                && Gender::parse(&s.gender) == Some(target.gender)
                && weight_class(&s.weight_class).as_deref() == Some(target.class.as_str())
        }) else {
            continue;
        };
        for (level, needed) in [("A", standard.standard_a), ("B", standard.standard_b)] {
            let (needed, status) = gap_cells(needed, total);
            table.add_row(vec![category.clone(), level.to_string(), needed, status]);
        }
    }
    table
}

pub fn totals_table(totals: &[QualifyingTotal], target: &Target, total: f64) -> Table {
    let mut rows: Vec<&QualifyingTotal> = totals
        .iter()
        .filter(|t| {
            target
                .categories
                .iter()
                .any(|c| t.age_category.eq_ignore_ascii_case(c))
                && Gender::parse(&t.gender) == Some(target.gender)
                && weight_class(&t.weight_class).as_deref() == Some(target.class.as_str())
        })
        .collect();
    rows.sort_by(|a, b| {
        a.event_name
            .cmp(&b.event_name)
            .then(a.age_category.cmp(&b.age_category))
    });
    let mut table = Table::new();
    table.set_header(vec!["Event", "Category", "Needed Total", "Status"]);
    if rows.is_empty() {
        table.add_row(vec![
            "—".to_string(),
            target.categories.join(" / "),
            "—".to_string(),
            format!(
                "No event lists a {}kg total for this category",
                target.class
            ),
        ]);
    }
    for t in rows {
        let (needed, status) = gap_cells(t.qualifying_total, total);
        table.add_row(vec![
            t.event_name.clone(),
            t.age_category.clone(),
            needed,
            status,
        ]);
    }
    table
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_comes_from_the_division_unless_overridden() {
        let division = Division::parse("Junior Men's 89kg");
        let target = target(&division, None, None).unwrap();
        assert_eq!(target.gender, Gender::Men);
        assert_eq!(target.categories, ["Junior", "Senior"]);
        assert_eq!(target.class, "89");
        let target = super::target(&division, Some("Senior"), Some("+110kg")).unwrap();
        assert_eq!(target.categories, ["Senior"]);
        assert_eq!(target.class, "110+");
        assert!(super::target(&division, None, Some("heavy")).is_err());
    }

    #[test]
    fn tables_show_what_is_met_and_what_is_left() {
        let standards = vec![Standard {
            age_category: "Youth".into(),
            gender: "Men".into(),
            weight_class: "+94kg".into(),
            standard_a: 260.0,
            standard_b: 240.0,
        }];
        let target = Target {
            gender: Gender::Men,
            categories: vec!["U17".into()],
            class: "94+".into(),
        };
        let json = Report::single("s", standards_table(&standards, &target, 250.0)).to_json();
        assert_eq!(json[0]["status"], "10 to go");
        assert_eq!(json[1]["status"], "Met");

        let totals = vec![QualifyingTotal {
            event_name: "Nationals".into(),
            gender: "Men".into(),
            age_category: "U17".into(),
            weight_class: "94+kg".into(),
            qualifying_total: 0.0,
        }];
        let json = Report::single("t", totals_table(&totals, &target, 250.0)).to_json();
        assert_eq!(json[0]["status"], "No standard");
    }
}
