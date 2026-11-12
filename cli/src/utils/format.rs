//! Display formats shared by the commands: dates and times in the meet's own time zone, as the
//! data stores them, and record holders.

use comfy_table::Table;

use crate::types::records::RecordHolder;
use crate::utils::stats::{number, weight_class};

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// `2026-06-20` as `Jun 20, 2026`; anything else as written.
pub(crate) fn us_date(value: &str) -> String {
    let parts: Vec<&str> = value.trim().split('-').collect();
    if let [year, month, day] = parts.as_slice()
        && let (Ok(year), Ok(month @ 1..=12), Ok(day @ 1..=31)) = (
            year.parse::<u32>(),
            month.parse::<usize>(),
            day.parse::<u32>(),
        )
        && let Some(month_name) = MONTHS.get(month - 1)
    {
        return format!("{month_name} {day}, {year}");
    }
    value.to_string()
}

/// A meet's dates: one date, or `Jun 20 – 21, 2026`, or the two dates in full.
pub(crate) fn date_range(start: &str, end: &str) -> String {
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
pub(crate) fn us_time(value: &str) -> String {
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

/// `08:00` or `08:00:00` as `08:00`, for JSON and CSV; anything else as written.
pub(crate) fn time_24h(value: &str) -> String {
    let mut parts = value.trim().split(':');
    let (Some(hour), Some(minute)) = (parts.next(), parts.next()) else {
        return value.to_string();
    };
    let (Ok(hour @ 0..=23), Ok(minute @ 0..=59)) = (hour.parse::<u32>(), minute.parse::<u32>())
    else {
        return value.to_string();
    };
    format!("{hour:02}:{minute:02}")
}

/// A lift in kilograms without a trailing `.0`; blank for none.
pub(crate) fn kg(value: f64) -> String {
    if value <= 0.0 {
        return String::new();
    }
    value.to_string()
}

pub(crate) const NO_VALUE: &str = "—";

pub(crate) fn display_body_weight(kilograms: f64) -> String {
    if kilograms.is_finite() && kilograms > 0.0 {
        number(kilograms)
    } else {
        NO_VALUE.to_string()
    }
}

pub(crate) fn display_weight_class(value: &str) -> String {
    weight_class(value).map_or_else(|| value.trim().to_string(), |class| format!("{class}kg"))
}

/// A record weight; blank for none. The records answer `0` for a lift with no record set.
fn record_weight(value: Option<f64>) -> String {
    value
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.to_string())
        .unwrap_or_default()
}

/// A record cell: the weight, then who set it, then when and where, one per line.
pub(crate) fn record_cell(value: Option<f64>, holder: Option<&RecordHolder>) -> String {
    let mut lines = vec![record_weight(value)];
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

pub(crate) fn capitalized(word: &str) -> String {
    let mut letters = word.chars();
    letters
        .next()
        .map(|first| first.to_uppercase().chain(letters).collect())
        .unwrap_or_default()
}

pub(crate) struct RecordRow<'a> {
    pub(crate) weight_class: &'a str,
    pub(crate) snatch: (Option<f64>, Option<&'a RecordHolder>),
    pub(crate) cj: (Option<f64>, Option<&'a RecordHolder>),
    pub(crate) total: (Option<f64>, Option<&'a RecordHolder>),
}

pub(crate) fn record_tables<'a>(rows: impl IntoIterator<Item = RecordRow<'a>>) -> (Table, Table) {
    let mut table = Table::new();
    table.set_header(vec!["Class", "Snatch", "CJ", "Total"]);
    let mut data = Table::new();
    data.set_header(record_data_header());
    for record in rows {
        let lifts = [record.snatch, record.cj, record.total];
        let weight_class = display_weight_class(record.weight_class);
        let mut row = vec![weight_class.clone()];
        row.extend(
            lifts
                .iter()
                .map(|(value, holder)| record_cell(*value, *holder)),
        );
        table.add_row(row);
        let mut data_row = vec![weight_class];
        for (value, holder) in lifts {
            data_row.extend(record_data_cells(value, holder));
        }
        data.add_row(data_row);
    }
    (table, data)
}

pub(crate) fn record_data_header() -> Vec<&'static str> {
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
pub(crate) fn record_data_cells(value: Option<f64>, holder: Option<&RecordHolder>) -> [String; 4] {
    [
        record_weight(value),
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
    fn capitalizing_raises_the_first_letter_whatever_its_alphabet() {
        assert_eq!(capitalized("open"), "Open");
        assert_eq!(capitalized("élan"), "Élan");
        assert_eq!(capitalized("Open"), "Open");
        assert_eq!(capitalized("2026"), "2026");
        assert_eq!(capitalized(""), "");
    }

    #[test]
    fn a_body_weight_the_source_did_not_record_shows_a_dash_not_zero() {
        assert_eq!(display_body_weight(70.5), "70.5");
        assert_eq!(display_body_weight(88.0), "88");
        assert_eq!(display_body_weight(0.0), "—");
        assert_eq!(display_body_weight(-1.0), "—");
        assert_eq!(display_body_weight(f64::NAN), "—");
    }

    #[test]
    fn a_weight_class_shows_in_the_form_every_surface_writes_it() {
        assert_eq!(display_weight_class("69"), "69kg");
        assert_eq!(display_weight_class("69kg"), "69kg");
        assert_eq!(display_weight_class("+110"), "110+kg");
        assert_eq!(display_weight_class("110+"), "110+kg");
        assert_eq!(display_weight_class("+110kg"), "110+kg");
        assert_eq!(display_weight_class("+110KG"), "110+kg");
        assert_eq!(display_weight_class("86+kg"), "86+kg");
        assert_eq!(display_weight_class(" 48 "), "48kg");
        assert_eq!(display_weight_class("Open"), "Open");
        assert_eq!(display_weight_class(""), "");
    }

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
        assert_eq!(time_24h("08:00:00"), "08:00");
        assert_eq!(time_24h("8:05"), "08:05");
        assert_eq!(time_24h("13:30"), "13:30");
        assert_eq!(time_24h("TBD"), "TBD");
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
        // A lift with no record set (the records answer 0) is blank, in the table and the export.
        assert_eq!(record_cell(Some(0.0), None), "");
        assert_eq!(record_data_cells(Some(0.0), None)[0], "");
        assert_eq!(record_data_cells(Some(40.0), None)[0], "40");
        assert_eq!(kg(0.0), "");
        assert_eq!(kg(142.5), "142.5");
    }
}
