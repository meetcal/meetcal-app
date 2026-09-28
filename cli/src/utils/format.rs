//! Display formats shared by the commands: dates and times in the meet's own time zone, as the
//! data stores them, and record holders.

use crate::types::records::RecordHolder;

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// `2026-06-20` as `Jun 20, 2026`; anything else as written.
pub fn us_date(value: &str) -> String {
    let parts: Vec<&str> = value.trim().split('-').collect();
    if let [year, month, day] = parts.as_slice()
        && let (Ok(year), Ok(month @ 1..=12), Ok(day @ 1..=31)) = (
            year.parse::<u32>(),
            month.parse::<usize>(),
            day.parse::<u32>(),
        )
    {
        return format!("{} {day}, {year}", MONTHS[month - 1]);
    }
    value.to_string()
}

/// A meet's dates: one date, or `Jun 20 – 21, 2026`, or the two dates in full.
pub fn date_range(start: &str, end: &str) -> String {
    if start == end || end.is_empty() {
        return us_date(start);
    }
    let (Some((start_year, start_rest)), Some((end_year, end_rest))) =
        (start.split_once('-'), end.split_once('-'))
    else {
        return format!("{} – {}", us_date(start), us_date(end));
    };
    let same_month = start_rest.get(..2) == end_rest.get(..2);
    if start_year == end_year && same_month {
        let end_day = end_rest
            .get(3..)
            .unwrap_or(end_rest)
            .trim_start_matches('0');
        let start_full = us_date(start);
        if let Some((month_day, year)) = start_full.rsplit_once(", ") {
            return format!("{month_day} – {end_day}, {year}");
        }
    }
    format!("{} – {}", us_date(start), us_date(end))
}

/// `08:00` or `08:00:00` as `8:00 AM`; anything else as written.
pub fn us_time(value: &str) -> String {
    let mut parts = value.trim().split(':');
    let (Some(hour), Some(minute)) = (parts.next(), parts.next()) else {
        return value.to_string();
    };
    let (Ok(hour @ 0..=23), Ok(minute @ 0..=59)) = (hour.parse::<u32>(), minute.parse::<u32>())
    else {
        return value.to_string();
    };
    let suffix = if hour < 12 { "AM" } else { "PM" };
    let hour = match hour % 12 {
        0 => 12,
        hour => hour,
    };
    format!("{hour}:{minute:02} {suffix}")
}

/// A lift in kilograms without a trailing `.0`; blank for none.
pub fn kg(value: f64) -> String {
    if value <= 0.0 {
        return String::new();
    }
    value.to_string()
}

/// A record cell: the weight, then who set it, then when and where, one per line.
pub fn record_cell(value: Option<f64>, holder: Option<&RecordHolder>) -> String {
    let mut lines = vec![value.map(|value| value.to_string()).unwrap_or_default()];
    if let Some(holder) = holder {
        lines.push(holder.name.clone());
        let detail: Vec<String> = [holder.date.as_deref().map(us_date), holder.location.clone()]
            .into_iter()
            .flatten()
            .filter(|part| !part.trim().is_empty())
            .collect();
        if !detail.is_empty() {
            lines.push(detail.join(" · "));
        }
    }
    lines.join("\n")
}

/// A record table's columns for JSON and CSV: the class, then for each lift its weight, holder,
/// date and place, one column each.
pub fn record_data_header() -> Vec<&'static str> {
    let mut header = vec!["Class"];
    for lift in ["Snatch", "CJ", "Total"] {
        header.extend(match lift {
            "Snatch" => ["Snatch", "Snatch Holder", "Snatch Date", "Snatch Location"],
            "CJ" => ["CJ", "CJ Holder", "CJ Date", "CJ Location"],
            _ => ["Total", "Total Holder", "Total Date", "Total Location"],
        });
    }
    header
}

/// One lift's four export columns: weight, holder, date (`YYYY-MM-DD` as stored), place.
pub fn record_data_cells(value: Option<f64>, holder: Option<&RecordHolder>) -> [String; 4] {
    [
        value.map(|value| value.to_string()).unwrap_or_default(),
        holder.map(|holder| holder.name.clone()).unwrap_or_default(),
        holder
            .and_then(|holder| holder.date.clone())
            .unwrap_or_default(),
        holder
            .and_then(|holder| holder.location.clone())
            .unwrap_or_default(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_read_as_us_dates() {
        assert_eq!(us_date("2026-06-20"), "Jun 20, 2026");
        assert_eq!(us_date("2026-13-01"), "2026-13-01");
        assert_eq!(us_date("12//5/26"), "12//5/26");
    }

    #[test]
    fn meet_dates_collapse_within_a_month() {
        assert_eq!(date_range("2026-06-20", "2026-06-20"), "Jun 20, 2026");
        assert_eq!(date_range("2026-06-20", "2026-06-21"), "Jun 20 – 21, 2026");
        assert_eq!(
            date_range("2026-06-30", "2026-07-02"),
            "Jun 30, 2026 – Jul 2, 2026"
        );
    }

    #[test]
    fn times_read_as_twelve_hour() {
        assert_eq!(us_time("08:00"), "8:00 AM");
        assert_eq!(us_time("12:30:00"), "12:30 PM");
        assert_eq!(us_time("00:15"), "12:15 AM");
        assert_eq!(us_time("TBD"), "TBD");
    }

    #[test]
    fn record_cells_show_the_holder_when_and_where() {
        let holder = RecordHolder {
            name: "Ada Lift".to_string(),
            date: Some("2025-06-01".to_string()),
            location: Some("Columbus, OH".to_string()),
        };
        assert_eq!(
            record_cell(Some(130.0), Some(&holder)),
            "130\nAda Lift\nJun 1, 2025 · Columbus, OH"
        );
        let standard = RecordHolder {
            name: "Standard".to_string(),
            date: None,
            location: None,
        };
        assert_eq!(record_cell(Some(90.0), Some(&standard)), "90\nStandard");
        assert_eq!(record_cell(None, None), "");
        assert_eq!(kg(0.0), "");
        assert_eq!(kg(142.5), "142.5");
    }
}
