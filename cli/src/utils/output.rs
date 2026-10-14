//! How a command's results are printed: as tables (the default), or as JSON or CSV for other
//! tools (`--format json|csv`).
//!
//! Commands build a [`Report`] of named tables and hand it to [`emit`].
//!
//! # The export schema
//!
//! JSON and CSV are for scripts, so what they carry does not depend on the data or the input:
//!
//! - A report of one table is an array of rows; a report of several is an object with one key
//!   per table, and every table is there even when it has no rows (`[]` in JSON, a header line in
//!   CSV).
//! - Each row is keyed by its table's column headers in snake_case. Headers never come from the
//!   input or the data (athlete names, years): a command whose table shows them exports a data
//!   table with fixed headers instead ([`Report::table_with_data`]).
//! - Cells that are numbers (optionally with a `kg` or `%` unit, or a sign) are numbers; `true`
//!   and `false` (and `Yes` and `No`) are booleans; `N/A`, a dash and empty cells are null.
//!   Weight classes stay text.
//! - Dates are `YYYY-MM-DD`, times `HH:MM` on a 24-hour clock, both as the data stores them in
//!   the meet's own time zone; a range is two columns (`start_date`, `end_date`). One cell holds
//!   one value: what the table packs into one cell (a total and its division) is split into
//!   columns.
//!
//! Table format can differ from all of this: it shows US dates, 12-hour times, dashes and
//! packed cells, wraps its tables to the terminal's width, and leaves out a table that is
//! optional and empty.

use std::io::{self, Write};
use std::sync::OnceLock;

use clap::ValueEnum;
use comfy_table::{ContentArrangement, Table};
use serde_json::{Map, Value};

/// How results are printed.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, ValueEnum)]
pub enum Format {
    /// Tables for reading in a terminal.
    #[default]
    Table,
    /// JSON: a table's rows as an array of objects; a report of several tables as an object
    /// keyed by table.
    Json,
    /// CSV: one header line and a line per row; several tables are separated by a blank line and
    /// a `# <table>` line.
    Csv,
}

static FORMAT: OnceLock<Format> = OnceLock::new();

/// Sets the format for this run; the first call wins.
pub fn set_format(format: Format) {
    let _ = FORMAT.set(format);
}

pub fn format() -> Format {
    FORMAT.get().copied().unwrap_or_default()
}

/// One table of a report.
pub struct Section {
    /// The table's key in JSON and CSV (snake_case).
    pub key: String,
    /// A line printed above the table in table format.
    pub heading: Option<String>,
    /// What table format shows.
    pub table: Table,
    /// What JSON and CSV export instead of `table`, when the display packs several values into
    /// one cell (a record's holder under its weight) or shows dates for reading.
    pub data: Option<Table>,
    /// When table format shows the table; JSON and CSV always carry it.
    pub shown: Shown,
}

/// When table format shows a section.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shown {
    Always,
    /// Only when it has rows.
    WithRows,
    /// Never: the table is for JSON and CSV only.
    Never,
}

/// A command's output: an optional title and its tables.
#[derive(Default)]
pub struct Report {
    pub title: Option<String>,
    pub sections: Vec<Section>,
    /// Printed instead of the tables in table format when there are no rows to show.
    pub empty_message: Option<String>,
}

impl Report {
    pub fn new() -> Self {
        Self::default()
    }

    /// A report of one table.
    pub fn single(key: &str, table: Table) -> Self {
        Self::new().table(key, table)
    }

    pub fn titled(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }

    pub fn table(self, key: &str, table: Table) -> Self {
        self.section(key, None, table, None, Shown::Always)
    }

    pub fn headed(self, key: &str, heading: impl Into<String>, table: Table) -> Self {
        self.section(key, Some(heading.into()), table, None, Shown::Always)
    }

    /// A table shown as `table` but exported as `data`.
    pub fn table_with_data(self, key: &str, table: Table, data: Table) -> Self {
        self.section(key, None, table, Some(data), Shown::Always)
    }

    /// A headed table shown as `table` but exported as `data`.
    pub fn headed_with_data(
        self,
        key: &str,
        heading: impl Into<String>,
        table: Table,
        data: Table,
    ) -> Self {
        self.section(key, Some(heading.into()), table, Some(data), Shown::Always)
    }

    /// A headed table that table format shows only when it has rows; JSON and CSV always carry
    /// it, so a script finds the key whatever the data.
    pub fn headed_if_any(self, key: &str, heading: impl Into<String>, table: Table) -> Self {
        self.section(key, Some(heading.into()), table, None, Shown::WithRows)
    }

    /// A table that only JSON and CSV carry, for a key they must always have.
    pub fn exported(self, key: &str, table: Table) -> Self {
        self.section(key, None, table, None, Shown::Never)
    }

    fn section(
        mut self,
        key: &str,
        heading: Option<String>,
        mut table: Table,
        data: Option<Table>,
        shown: Shown,
    ) -> Self {
        // Fit the table to the terminal, wrapping long cells. Without a terminal (output piped
        // or redirected) there is no width to fit, and the table prints as it is.
        table.set_content_arrangement(ContentArrangement::Dynamic);
        self.sections.push(Section {
            key: key.to_string(),
            heading,
            table,
            data,
            shown,
        });
        self
    }

    pub fn when_empty(mut self, message: impl Into<String>) -> Self {
        self.empty_message = Some(message.into());
        self
    }

    fn is_empty(&self) -> bool {
        self.sections
            .iter()
            .all(|section| section.table.row_iter().next().is_none())
    }

    /// The report as table format prints it.
    pub fn to_text(&self) -> String {
        if let (true, Some(message)) = (self.is_empty(), &self.empty_message) {
            return message.clone();
        }
        let mut parts = Vec::new();
        if let Some(title) = &self.title {
            parts.push(title.clone());
        }
        for section in &self.sections {
            let has_rows = section.table.row_iter().next().is_some();
            if section.shown == Shown::Never || (section.shown == Shown::WithRows && !has_rows) {
                continue;
            }
            if let Some(heading) = &section.heading {
                parts.push(heading.clone());
            }
            parts.push(section.table.to_string());
        }
        parts.join("\n")
    }

    /// The report as JSON: one table's rows, or an object of each table's rows.
    pub fn to_json(&self) -> Value {
        if self.sections.len() == 1 {
            return Value::Array(rows(export_table(&self.sections[0])));
        }
        let mut object = Map::new();
        for section in &self.sections {
            object.insert(
                section.key.clone(),
                Value::Array(rows(export_table(section))),
            );
        }
        Value::Object(object)
    }

    /// The report as CSV.
    pub fn to_csv(&self) -> String {
        let several = self.sections.len() > 1;
        self.sections
            .iter()
            .map(|section| {
                let csv = csv_table(export_table(section));
                if several {
                    format!("# {}\n{csv}", section.key)
                } else {
                    csv
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

/// Prints `report` in the run's format.
///
/// A reader that stops early (`meetcal leaderboard | head`, quitting `less`) closes the pipe; the
/// run then ends quietly with status 0, as other command line tools do, instead of panicking
/// in `println!`. Any other failure to write ends it with status 1.
pub fn emit(report: Report) {
    let mut stdout = io::stdout().lock();
    let written = write(&mut stdout, &report, format()).and_then(|()| stdout.flush());
    if let Err(error) = written {
        if error.kind() == io::ErrorKind::BrokenPipe {
            std::process::exit(0);
        }
        eprintln!("Error: could not write the output: {error}");
        std::process::exit(1);
    }
}

/// Writes `report` to `out` in `format`.
pub fn write(out: &mut impl Write, report: &Report, format: Format) -> io::Result<()> {
    match format {
        Format::Table => writeln!(out, "{}", report.to_text()),
        Format::Json => writeln!(
            out,
            "{}",
            serde_json::to_string_pretty(&report.to_json()).unwrap_or_else(|_| "null".into())
        ),
        Format::Csv => write!(out, "{}", report.to_csv()),
    }
}

/// A one-column table of `values` under `header`, for plain lists (club names, WSOs).
pub fn list(header: &str, values: impl IntoIterator<Item = impl Into<String>>) -> Table {
    let mut table = Table::new();
    table.set_header(vec![header]);
    for value in values {
        table.add_row(vec![value.into()]);
    }
    table
}

fn export_table(section: &Section) -> &Table {
    section.data.as_ref().unwrap_or(&section.table)
}

fn headers(table: &Table) -> Vec<String> {
    table
        .header()
        .map(|header| {
            header
                .cell_iter()
                .map(|cell| key(&cell.content()))
                .collect()
        })
        .unwrap_or_default()
}

fn cells(table: &Table) -> Vec<Vec<String>> {
    table
        .row_iter()
        .map(|row| row.cell_iter().map(|cell| cell.content()).collect())
        .collect()
}

fn rows(table: &Table) -> Vec<Value> {
    let headers = headers(table);
    cells(table)
        .into_iter()
        .map(|row| {
            let mut object = Map::new();
            for (index, cell) in row.into_iter().enumerate() {
                let name = headers
                    .get(index)
                    .cloned()
                    .unwrap_or_else(|| format!("column_{}", index + 1));
                // Weight classes stay text: `60kg` and `110+kg` are the same kind of value.
                let cell = if name.contains("class") {
                    text_value(&cell)
                } else {
                    value(&cell)
                };
                object.insert(name, cell);
            }
            Value::Object(object)
        })
        .collect()
}

fn csv_table(table: &Table) -> String {
    let mut lines = vec![
        headers(table)
            .iter()
            .map(|h| csv_field(h))
            .collect::<Vec<_>>()
            .join(","),
    ];
    for row in cells(table) {
        lines.push(
            row.iter()
                .map(|cell| csv_field(&csv_value(cell)))
                .collect::<Vec<_>>()
                .join(","),
        );
    }
    lines.join("\n") + "\n"
}

/// A cell as CSV writes it: the same value JSON gets, so the two formats agree. Placeholders
/// are empty, booleans `true`/`false`, numbers without their unit, text as it is.
fn csv_value(cell: &str) -> String {
    match value(cell) {
        Value::Null => String::new(),
        Value::String(text) => text,
        other => other.to_string(),
    }
}

fn csv_field(value: &str) -> String {
    let value = value.replace('\n', " ");
    if value.contains([',', '"']) || value.starts_with(' ') || value.ends_with(' ') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value
    }
}

/// A header as a JSON key: `Best C&J` becomes `best_c_j`, `% Difference` `difference`.
pub fn key(header: &str) -> String {
    let mut key = String::new();
    for c in header.chars() {
        if c.is_alphanumeric() {
            key.extend(c.to_lowercase());
        } else if !key.is_empty() && !key.ends_with('_') {
            key.push('_');
        }
    }
    key.trim_end_matches('_').to_string()
}

/// A cell as JSON text, or null when empty.
fn text_value(cell: &str) -> Value {
    let text = cell.trim();
    if text.is_empty() {
        Value::Null
    } else {
        Value::String(text.to_string())
    }
}

/// A cell as a JSON value: a number when it is one (units `kg` and `%` and a sign allowed), a
/// boolean for `true`/`false` and `Yes`/`No`, null when empty, `N/A` or a dash, the text
/// otherwise.
pub fn value(cell: &str) -> Value {
    let text = cell.trim();
    if text.is_empty() || text.eq_ignore_ascii_case("n/a") || matches!(text, "—" | "–" | "-") {
        return Value::Null;
    }
    match text {
        "true" | "Yes" => return Value::Bool(true),
        "false" | "No" => return Value::Bool(false),
        _ => {}
    }
    let number = text
        .strip_suffix("kg")
        .or_else(|| text.strip_suffix('%'))
        .unwrap_or(text)
        .trim()
        .trim_start_matches('+');
    if let Ok(number) = number.parse::<f64>()
        && number.is_finite()
        && !number.is_nan()
        && !text.contains(' ')
    {
        if number.fract() == 0.0 && number.abs() < 9e15 {
            return Value::from(number as i64);
        }
        return Value::from(number);
    }
    Value::String(text.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn table(header: &[&str], rows: &[&[&str]]) -> Table {
        let mut table = Table::new();
        table.set_header(header.to_vec());
        for row in rows {
            table.add_row(row.to_vec());
        }
        table
    }

    #[test]
    fn keys_are_snake_case() {
        assert_eq!(key("Best C&J"), "best_c_j");
        assert_eq!(key("% Difference"), "difference");
        assert_eq!(
            key("Past-year bests\n(Sn / CJ / Total)"),
            "past_year_bests_sn_cj_total"
        );
    }

    #[test]
    fn cells_become_numbers_nulls_or_text() {
        assert_eq!(value("142.5"), json!(142.5));
        assert_eq!(value("74kg"), json!(74));
        assert_eq!(value("83.3%"), json!(83.3));
        assert_eq!(value("+12kg"), json!(12));
        assert_eq!(value("-103"), json!(-103));
        assert_eq!(value("N/A"), Value::Null);
        assert_eq!(value(""), Value::Null);
        assert_eq!(value("Jun 20, 2026"), json!("Jun 20, 2026"));
        assert_eq!(value("2026"), json!(2026));
        assert_eq!(value("95 / 120 / 215"), json!("95 / 120 / 215"));
    }

    #[test]
    fn one_table_is_an_array_and_several_an_object() {
        let one = Report::single(
            "meets",
            table(&["Meet", "Athletes", "Class"], &[&["A", "12", "60kg"]]),
        );
        assert_eq!(
            one.to_json(),
            json!([{ "meet": "A", "athletes": 12, "class": "60kg" }])
        );

        let two = Report::new()
            .table("summary", table(&["Meets"], &[&["3"]]))
            .table("lifts", table(&["Best Total"], &[&["215kg"]]));
        assert_eq!(
            two.to_json(),
            json!({ "summary": [{ "meets": 3 }], "lifts": [{ "best_total": 215 }] })
        );
    }

    #[test]
    fn csv_quotes_what_needs_it_and_exports_data_tables() {
        let shown = table(&["Snatch"], &[&["130\nAda\nJun 1, 2025"]]);
        let data = table(&["Snatch", "Snatch Holder"], &[&["130", "Lift, Ada"]]);
        let report = Report::new().table_with_data("records", shown, data);
        assert_eq!(report.to_csv(), "snatch,snatch_holder\n130,\"Lift, Ada\"\n");
    }

    #[test]
    fn csv_carries_the_values_json_does() {
        let report = Report::single(
            "editions",
            table(
                &[
                    "Registered",
                    "Lifters",
                    "Adaptive",
                    "Lifted",
                    "Change",
                    "Meet",
                ],
                &[&["—", "174", "Yes", "620kg", "N/A", "Ohio Open"]],
            ),
        );
        assert_eq!(
            report.to_csv(),
            "registered,lifters,adaptive,lifted,change,meet\n,174,true,620,,Ohio Open\n"
        );
    }

    #[test]
    fn placeholders_become_null_and_yes_no_booleans() {
        assert_eq!(value("—"), Value::Null);
        assert_eq!(value("-"), Value::Null);
        assert_eq!(value("true"), json!(true));
        assert_eq!(value("Yes"), json!(true));
        assert_eq!(value("false"), json!(false));
        assert_eq!(value("No"), json!(false));
        assert_eq!(value("Not set"), json!("Not set"));
    }

    #[test]
    fn optional_tables_are_always_exported_but_shown_only_with_rows() {
        let report = Report::new()
            .headed("summary", "SUMMARY", table(&["Athletes"], &[&["3"]]))
            .headed_if_any("medals", "MEDALS", table(&["Athlete", "Place"], &[]));
        assert_eq!(
            report.to_json(),
            json!({ "summary": [{ "athletes": 3 }], "medals": [] })
        );
        assert_eq!(
            report.to_csv(),
            "# summary\nathletes\n3\n\n# medals\nathlete,place\n"
        );
        assert!(!report.to_text().contains("MEDALS"));
    }

    #[test]
    fn tables_wrap_to_the_width_they_are_given() {
        let long = "A meet name long enough to need wrapping in a narrow terminal";
        let mut report = Report::single("meets", table(&["Meet", "Dates"], &[&[long, "Jun 1"]]));
        report.sections[0].table.set_width(40);
        let text = report.to_text();
        assert!(text.lines().count() > 3, "{text}");
        assert!(
            text.lines().all(|line| line.chars().count() <= 40),
            "{text}"
        );
    }

    #[test]
    fn write_reports_a_closed_pipe() {
        struct Closed;
        impl Write for Closed {
            fn write(&mut self, _: &[u8]) -> io::Result<usize> {
                Err(io::ErrorKind::BrokenPipe.into())
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        let report = Report::single("meets", table(&["Meet"], &[&["A"]]));
        let error = write(&mut Closed, &report, Format::Csv).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::BrokenPipe);
    }

    #[test]
    fn text_keeps_titles_headings_and_the_empty_message() {
        let report = Report::new()
            .titled("TITLE")
            .headed("a", "HEADING", table(&["X"], &[&["1"]]));
        let text = report.to_text();
        assert!(text.starts_with("TITLE\nHEADING\n"));
        let empty = Report::single("meets", table(&["Meet"], &[])).when_empty("No meets.");
        assert_eq!(empty.to_text(), "No meets.");
        assert_eq!(empty.to_json(), json!([]));
    }
}
