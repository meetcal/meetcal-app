use serde::Deserialize;

/// A meet, as `meets:list`, `meets:completed` and `meets:details` answer it.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Meet {
    pub name: String,
    #[serde(default)]
    pub federation: String,
    pub status: String,
    pub start_date: String,
    pub end_date: String,
    pub time_zone: String,
    pub venue_name: String,
    pub venue_street: String,
    pub venue_city: String,
    pub venue_state: String,
    pub venue_zip: String,
    pub venue_map_pdf_url: Option<String>,
    pub venue_map_apple_url: Option<String>,
}

/// One session's weight class on a meet's schedule (`meets:schedule`), in the meet's time zone.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct ScheduleRow {
    pub date: String,
    pub session_id: f64,
    pub platform: String,
    pub weigh_in_time: String,
    pub start_time: String,
    pub weight_class: String,
}

/// An athlete's best lifts since a cutoff (`results:bests`); zero where they have none.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct NamedBests {
    pub name: String,
    pub best_snatch: f64,
    pub best_cj: f64,
    pub best_total: f64,
}
