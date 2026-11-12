use serde::Deserialize;

/// A meet, as `meets:list`, `meets:completed` and `meets:details` answer it.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub(crate) struct Meet {
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) federation: String,
    pub(crate) status: String,
    pub(crate) start_date: String,
    pub(crate) end_date: String,
    pub(crate) time_zone: String,
    pub(crate) venue_name: String,
    pub(crate) venue_street: String,
    pub(crate) venue_city: String,
    pub(crate) venue_state: String,
    pub(crate) venue_zip: String,
    pub(crate) venue_map_pdf_url: Option<String>,
    pub(crate) venue_map_apple_url: Option<String>,
}

/// One session's weight class on a meet's schedule (`meets:schedule`), in the meet's time zone.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub(crate) struct ScheduleRow {
    pub(crate) date: String,
    pub(crate) session_id: f64,
    pub(crate) platform: String,
    pub(crate) weigh_in_time: String,
    pub(crate) start_time: String,
    pub(crate) weight_class: String,
}

/// An athlete's best lifts since a cutoff (`results:bests`); zero where they have none.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub(crate) struct NamedBests {
    pub(crate) name: String,
    pub(crate) best_snatch: f64,
    pub(crate) best_cj: f64,
    pub(crate) best_total: f64,
}
