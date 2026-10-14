use anyhow::{Result, bail};
use clap::Parser;
use comfy_table::Table;
use serde::Deserialize;

use chrono::Utc;

use crate::commands::leaderboard::EXCLUDED_FEDERATION;
use crate::types::lifting_results::LiftingResults;
use crate::utils::athletes::history;
use crate::utils::backend::{NoArgs, queries, query};
use crate::utils::bests::{YEAR_BESTS_YEARS, cutoff_date};
use crate::utils::filters;
use crate::utils::format::us_date;
use crate::utils::output::{self, Report};
use crate::utils::stats::{
    Division, Gender, Lift, PLAUSIBLE_BODY_WEIGHT, chronological, number, valid_lift, valid_total,
    weight_class,
};

/// Show how far an athlete's best lifts over the past year are from the USAW A/B standards and
/// each event's qualifying total in their class.
///
/// The athlete's gender, age category and weight class come from their latest result; override
/// them with --category and --class. A class retired when USA Weightlifting adopted the IWF's
/// classes on Aug 1, 2026 is checked as the lightest current class holding the result's
/// bodyweight. Only lifts made at or under the class's bodyweight limit count: a total made in a
/// heavier class does not qualify for a lighter one.
#[derive(Parser)]
#[command(
    name = "qualify",
    after_help = r#"Examples:
  meetcal qualify "Brandon Victorian"
  meetcal qualify "Brandon Victorian" --class 94"#
)]
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

/// The day USA Weightlifting replaced its bodyweight classes with the IWF's new set.
pub const CLASS_CHANGE: &str = "2026-08-01";
/// The classes since [`CLASS_CHANGE`]: juniors, seniors and Masters, then youth (U17 and U15).
const SENIOR_MEN: &[&str] = &["60", "65", "70", "75", "85", "95", "110", "110+"];
const SENIOR_WOMEN: &[&str] = &["49", "53", "57", "61", "69", "77", "86", "86+"];
const YOUTH_MEN: &[&str] = &["55", "60", "65", "70", "75", "85", "95", "95+"];
const YOUTH_WOMEN: &[&str] = &["45", "49", "53", "57", "61", "69", "77", "77+"];

/// The current classes for a gender and age category; `None` where we don't know them (U13 and
/// younger).
fn current_classes(gender: Gender, category: Option<&str>) -> Option<&'static [&'static str]> {
    let youth = match category {
        Some(category)
            if category.eq_ignore_ascii_case("U17") || category.eq_ignore_ascii_case("U15") =>
        {
            true
        }
        Some(category)
            if category.eq_ignore_ascii_case("U13") || category.eq_ignore_ascii_case("U11") =>
        {
            return None;
        }
        _ => false,
    };
    Some(match (gender, youth) {
        (Gender::Men, false) => SENIOR_MEN,
        (Gender::Women, false) => SENIOR_WOMEN,
        (Gender::Men, true) => YOUTH_MEN,
        (Gender::Women, true) => YOUTH_WOMEN,
    })
}

/// The lightest of `classes` whose limit holds `body_weight`.
fn class_for(body_weight: f64, classes: &[&str]) -> Option<String> {
    classes
        .iter()
        .find(|class| class.ends_with('+') || class_limit(class) >= body_weight)
        .map(|class| class.to_string())
}

/// A class's bodyweight limit: `75` for `75`, none for `110+`.
pub fn class_limit(class: &str) -> f64 {
    if class.ends_with('+') {
        f64::INFINITY
    } else {
        class.parse().unwrap_or(f64::INFINITY)
    }
}

/// The best snatch, clean & jerk and total among results dated on or after `cutoff` and made at
/// or under the class's bodyweight `limit`. USA Weightlifting counts a total toward a class only
/// when it was made at or under that class's limit, so a class with a limit needs a plausible
/// bodyweight ([`PLAUSIBLE_BODY_WEIGHT`]: not a 0.9 kg source error). Source errors and British
/// results ([`EXCLUDED_FEDERATION`]) are left out: these are USA Weightlifting's totals.
pub fn bests_within(rows: &[LiftingResults], cutoff: &str, limit: f64) -> (f64, f64, f64) {
    rows.iter()
        .filter(|row| !row.federation.eq_ignore_ascii_case(EXCLUDED_FEDERATION))
        .filter(|row| row.date.as_str() >= cutoff)
        .filter(|row| {
            limit.is_infinite()
                || (PLAUSIBLE_BODY_WEIGHT.contains(&row.body_weight) && row.body_weight <= limit)
        })
        .fold((0.0, 0.0, 0.0), |(snatch, cj, total), row| {
            (
                snatch.max(valid_lift(row, Lift::Snatch).unwrap_or(0.0)),
                cj.max(valid_lift(row, Lift::CleanAndJerk).unwrap_or(0.0)),
                total.max(valid_total(row).unwrap_or(0.0)),
            )
        })
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
    /// The latest result's class when it was retired on [`CLASS_CHANGE`] and `class` replaced it.
    pub retired: Option<String>,
}

pub async fn run(args: QualifyArgs) -> Result<()> {
    let rows = history(&args.name).await?;
    let latest = chronological(&rows)
        .last()
        .copied()
        .expect("history is never empty");
    let name = latest.name.clone();
    let division = Division::parse(&latest.age);
    let target = target(
        &division,
        latest.body_weight,
        args.category.as_deref(),
        args.class.as_deref(),
    )?;

    let cutoff = cutoff_date(Utc::now().date_naive(), YEAR_BESTS_YEARS);
    let limit = class_limit(&target.class);
    let (snatch, cj, total) = bests_within(&rows, &cutoff, limit);

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
        "Counted Results",
        "Note",
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
        if limit.is_infinite() {
            "Any bodyweight".to_string()
        } else {
            format!("Bodyweight at or under {}kg", target.class)
        },
        target
            .retired
            .as_ref()
            .map(|old| {
                format!(
                    "Checked as {}kg: the {old}kg class was retired on {}",
                    target.class,
                    us_date(CLASS_CHANGE)
                )
            })
            .unwrap_or_default(),
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

/// The categories and class to check: the overrides, or what `division` says. A class no longer
/// current is replaced by the lightest current class holding `body_weight`, the latest result's.
pub fn target(
    division: &Division,
    body_weight: f64,
    category: Option<&str>,
    class: Option<&str>,
) -> Result<Target> {
    let Some(gender) = division.gender else {
        bail!("Could not tell the gender from the latest result's division");
    };
    let primary = match category {
        Some(category) => Some(filters::category(category)?),
        None => division.category.clone(),
    };
    let (class, retired) = match class {
        Some(class) => match weight_class(class) {
            Some(class) => (class, None),
            None => bail!(
                "Weight class (--class, -c) must look like 89 or 110+, not \"{class}\"; \
                 the age category is --category (-a)"
            ),
        },
        None => match &division.weight_class {
            Some(class) => match current_classes(gender, primary.as_deref()) {
                Some(current) if !current.contains(&class.as_str()) => {
                    match class_for(body_weight, current)
                        .filter(|_| PLAUSIBLE_BODY_WEIGHT.contains(&body_weight))
                    {
                        Some(replacement) => (replacement, Some(class.clone())),
                        None => (class.clone(), None),
                    }
                }
                _ => (class.clone(), None),
            },
            None => bail!("Could not tell the weight class from the latest result; pass --class"),
        },
    };
    let mut categories: Vec<String> = primary.into_iter().collect();
    if !categories.iter().any(|c| c.eq_ignore_ascii_case("Senior")) {
        categories.push("Senior".into());
    }
    Ok(Target {
        gender,
        categories,
        class,
        retired,
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
        let division = Division::parse("Junior Men's 85kg");
        let target = target(&division, 84.0, None, None).unwrap();
        assert_eq!(target.gender, Gender::Men);
        assert_eq!(target.categories, ["Junior", "Senior"]);
        assert_eq!(target.class, "85");
        assert_eq!(target.retired, None);
        let target = super::target(&division, 84.0, Some("Senior"), Some("+110kg")).unwrap();
        assert_eq!(target.categories, ["Senior"]);
        assert_eq!(target.class, "110+");
        assert!(super::target(&division, 84.0, None, Some("heavy")).is_err());
        let mixed = Division::parse("Men's/Women's Youth Under 12 40kg");
        assert!(super::target(&mixed, 40.0, None, None).is_err());
    }

    #[test]
    fn a_retired_class_is_checked_as_the_current_class_holding_the_bodyweight() {
        // Luc Spalding: 287 at 78.3 kg in the 79 kg class, retired on Aug 1, 2026.
        let division = Division::parse("Open Men's 79kg");
        let target = target(&division, 78.3, None, None).unwrap();
        assert_eq!(target.class, "85");
        assert_eq!(target.retired.as_deref(), Some("79"));
        let heavy = target_for("Open Men's +110kg", 140.0);
        assert_eq!((heavy.class.as_str(), heavy.retired), ("110+", None));
        let women = target_for("Junior Women's 63kg", 62.5);
        assert_eq!(women.class, "69");
        let youth = target_for("Men's 16-17 Age Group 56kg", 55.5);
        assert_eq!(youth.class, "60");
        let youth = target_for("Women's 16-17 Age Group 44kg", 43.0);
        assert_eq!(youth.class, "45");
        // U13 classes are not ours to remap.
        let u13 = target_for("Men's 13 Under Age Group 44kg", 43.0);
        assert_eq!((u13.class.as_str(), u13.retired), ("44", None));
        // A source-error bodyweight maps nowhere: the class stays as the division names it.
        for body_weight in [0.9, 12.0] {
            let error = target_for("Open Men's 79kg", body_weight);
            assert_eq!((error.class.as_str(), error.retired), ("79", None));
        }
    }

    fn target_for(division: &str, body_weight: f64) -> Target {
        target(&Division::parse(division), body_weight, None, None).unwrap()
    }

    #[test]
    fn totals_made_in_a_heavier_class_do_not_count() {
        use crate::utils::stats::tests::row;
        // Roy Maher: every past-year total was made over 75 kg; his 75 kg result bombed out.
        let lift = |date: &str, bw: f64, snatch: f64, cj: f64| {
            row(
                "Roy",
                date,
                "M",
                "Junior Men's 79kg",
                bw,
                [snatch, 0.0, 0.0],
                [cj, 0.0, 0.0],
            )
        };
        let rows = vec![
            lift("2026-03-01", 78.3, 127.0, 163.0),
            lift("2026-06-01", 80.75, 130.0, 160.0),
            lift("2026-09-13", 74.9, -120.0, 150.0),
            lift("2025-01-01", 74.0, 140.0, 170.0),
        ];
        assert_eq!(bests_within(&rows, "2025-10-12", 75.0), (0.0, 150.0, 0.0));
        assert_eq!(
            bests_within(&rows, "2025-10-12", f64::INFINITY),
            (130.0, 163.0, 290.0)
        );
        assert_eq!(
            bests_within(&rows, "2025-10-12", class_limit("85")),
            (130.0, 163.0, 290.0)
        );
    }

    #[test]
    fn british_results_and_impossible_bodyweights_do_not_count() {
        use crate::utils::stats::tests::row;
        let lift = |bw: f64, snatch: f64, cj: f64| {
            row(
                "Ada",
                "2026-03-01",
                "M",
                "Open Men's 79kg",
                bw,
                [snatch, 0.0, 0.0],
                [cj, 0.0, 0.0],
            )
        };
        let mut british = lift(74.0, 110.0, 130.0);
        british.federation = "BWL".into();
        let rows = vec![
            british,
            lift(0.9, 105.0, 125.0),
            lift(0.0, 104.0, 124.0),
            lift(74.5, 90.0, 110.0),
        ];
        assert_eq!(
            bests_within(&rows, "2025-10-12", 75.0),
            (90.0, 110.0, 200.0)
        );
        // A plus class has no limit, so a missing or wrong bodyweight does not matter there.
        assert_eq!(
            bests_within(&rows, "2025-10-12", f64::INFINITY),
            (105.0, 125.0, 230.0)
        );
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
            retired: None,
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
