pub(crate) fn yes_no(value: bool) -> &'static str {
    if value { "Yes" } else { "No" }
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
    fn booleans_display_as_yes_or_no() {
        assert_eq!(yes_no(true), "Yes");
        assert_eq!(yes_no(false), "No");
    }
}
