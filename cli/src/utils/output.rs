//! How a command's results are printed: as tables (the default), or as JSON or CSV for other
//! tools (`--format json|csv`).
//!
//! Commands build a [`Report`] of named tables and hand it to [`emit`]. In the machine formats,
//! each table becomes rows keyed by its column headers in snake_case; cells that are numbers
//! (optionally with a `kg` or `%` unit, or a sign) become numbers, and `N/A` or empty cells
//! become null.

use std::sync::OnceLock;

use clap::ValueEnum;
use comfy_table::Table;
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
    /// one cell (a record's holder under its weight).
    pub data: Option<Table>,
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

    pub fn table(mut self, key: &str, table: Table) -> Self {
        self.sections.push(Section {
            key: key.to_string(),
            heading: None,
            table,
            data: None,
        });
        self
    }

    pub fn headed(mut self, key: &str, heading: impl Into<String>, table: Table) -> Self {
        self.sections.push(Section {
            key: key.to_string(),
            heading: Some(heading.into()),
            table,
            data: None,
        });
        self
    }

    /// A table shown as `table` but exported as `data`.
    pub fn table_with_data(mut self, key: &str, table: Table, data: Table) -> Self {
        self.sections.push(Section {
            key: key.to_string(),
            heading: None,
            table,
            data: Some(data),
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
pub fn emit(report: Report) {
    match format() {
        Format::Table => println!("{}", report.to_text()),
        Format::Json => println!(
            "{}",
            serde_json::to_string_pretty(&report.to_json()).unwrap_or_else(|_| "null".into())
        ),
        Format::Csv => print!("{}", report.to_csv()),
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
                .map(|cell| csv_field(cell))
                .collect::<Vec<_>>()
                .join(","),
        );
    }
    lines.join("\n") + "\n"
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

/// A cell as a JSON value: a number when it is one (units `kg` and `%` and a sign allowed),
/// null when empty or `N/A`, the text otherwise.
pub fn value(cell: &str) -> Value {
    let text = cell.trim();
    if text.is_empty() || text.eq_ignore_ascii_case("n/a") {
        return Value::Null;
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
