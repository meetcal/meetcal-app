pub(crate) fn yes_no(value: bool) -> &'static str {
    if value { "Yes" } else { "No" }
}

/// A weight class as every table shows it: `69` → `69kg`, and the open class
/// written either way round (`+110`, `110+`, `+110kg`) → `110+kg`, the app's
/// form (`src/lib/start-list-utils.ts`). Anything else is left as given.
pub(crate) fn display_weight_class(value: &str) -> String {
    let trimmed = value.trim();
    let number = trimmed
        .strip_suffix("kg")
        .or_else(|| trimmed.strip_suffix("KG"))
        .or_else(|| trimmed.strip_suffix("Kg"))
        .unwrap_or(trimmed)
        .trim();
    let (open, digits) = match (number.strip_prefix('+'), number.strip_suffix('+')) {
        (Some(rest), _) => (true, rest),
        (None, Some(rest)) => (true, rest),
        (None, None) => (false, number),
    };
    let is_class = !digits.is_empty()
        && digits
            .chars()
            .all(|character| character.is_ascii_digit() || character == '.')
        && digits
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_digit());
    match (is_class, open) {
        (true, true) => format!("{digits}+kg"),
        (true, false) => format!("{digits}kg"),
        (false, _) => trimmed.to_owned(),
    }
}

/// A gender as every table shows it: the roster's `Female` / `Male` read
/// `Women` / `Men`, as on every other data page.
pub(crate) fn display_gender(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.eq_ignore_ascii_case("female") {
        "Women".to_owned()
    } else if trimmed.eq_ignore_ascii_case("male") {
        "Men".to_owned()
    } else {
        trimmed.to_owned()
    }
}

/// A record, lift or standard, or "—" when there is none. The reference tables answer `0` for
/// "no record set / no standard" (every U15 B standard, unset masters records) and WSO records
/// answer `null` for a lift the source left out; neither is a weight anyone has to beat. The app
/// (`formatReferenceKg`) and the CLI's `kg` read `<= 0` the same way.
pub(crate) fn reference_value(value: Option<f64>) -> String {
    match value {
        Some(value) if value.is_finite() && value > 0.0 => value.to_string(),
        _ => "—".to_owned(),
    }
}

pub(crate) fn format_us_date(value: &str) -> String {
    const MONTHS: [&str; 12] = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];
    let parts = value.split('-').collect::<Vec<_>>();
    let parsed = parts
        .as_slice()
        .try_into()
        .ok()
        .and_then(|[year, month, day]: [&str; 3]| {
            Some((
                year.parse::<u32>().ok()?,
                month.parse::<usize>().ok()?,
                day.parse::<u32>().ok()?,
            ))
        });
    match parsed {
        Some((year, month @ 1..=12, day @ 1..=31)) => {
            format!("{} {day}, {year}", MONTHS[month - 1])
        }
        _ => value.to_owned(),
    }
}

pub(crate) fn format_us_time(value: &str) -> String {
    let parts = value.split(':').collect::<Vec<_>>();
    let Some((hour, minute)) = parts
        .first()
        .and_then(|hour| hour.parse::<u32>().ok())
        .zip(parts.get(1).and_then(|minute| minute.parse::<u32>().ok()))
    else {
        return value.to_owned();
    };
    if hour > 23 || minute > 59 {
        return value.to_owned();
    }
    let suffix = if hour < 12 { "AM" } else { "PM" };
    let display_hour = match hour % 12 {
        0 => 12,
        hour => hour,
    };
    format!("{display_hour}:{minute:02} {suffix}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reference_values_show_none_for_zero_or_missing() {
        assert_eq!(reference_value(Some(184.0)), "184");
        assert_eq!(reference_value(Some(102.5)), "102.5");
        assert_eq!(reference_value(Some(0.0)), "—");
        assert_eq!(reference_value(Some(-1.0)), "—");
        assert_eq!(reference_value(Some(f64::NAN)), "—");
        assert_eq!(reference_value(None), "—");
    }

    #[test]
    fn dates_and_times_use_us_display_formats() {
        assert_eq!(format_us_date("2026-06-20"), "June 20, 2026");
        assert_eq!(format_us_time("08:00:00"), "8:00 AM");
        assert_eq!(format_us_time("12:30"), "12:30 PM");
    }

    #[test]
    fn weight_classes_read_the_same_whichever_way_the_answer_writes_them() {
        for (raw, shown) in [
            ("69", "69kg"),
            ("86+", "86+kg"),
            ("+86", "86+kg"),
            ("110", "110kg"),
            ("110+", "110+kg"),
            ("+110", "110+kg"),
            ("71kg", "71kg"),
            ("+86kg", "86+kg"),
            ("86+kg", "86+kg"),
            (" 63 ", "63kg"),
            ("", ""),
            ("Open", "Open"),
        ] {
            assert_eq!(display_weight_class(raw), shown, "{raw:?}");
        }
    }

    #[test]
    fn roster_genders_read_women_and_men() {
        assert_eq!(display_gender("Female"), "Women");
        assert_eq!(display_gender("MALE"), "Men");
        assert_eq!(display_gender("Women"), "Women");
        assert_eq!(display_gender("Men"), "Men");
    }

    #[test]
    fn booleans_display_as_yes_or_no() {
        assert_eq!(yes_no(true), "Yes");
        assert_eq!(yes_no(false), "No");
    }
}
