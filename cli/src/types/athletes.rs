use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub(crate) struct Athletes {
    pub(crate) adaptive: bool,
    pub(crate) age: f64,
    pub(crate) club: String,
    pub(crate) entry_total: f64,
    pub(crate) gender: String,
    pub(crate) name: String,
    pub(crate) session_number: Option<f64>,
    /// As the meet names it (Red, White, Gold, Platform A, …).
    pub(crate) session_platform: Option<String>,
    pub(crate) weight_class: String,
    pub(crate) wso: Option<String>,
    /// The session's date and times in the meet's time zone, on start-list rows
    /// (`meets:athletesSessions`) for athletes with a session.
    #[serde(default)]
    pub(crate) date: Option<String>,
    #[serde(default)]
    pub(crate) weigh_in_time: Option<String>,
    #[serde(default)]
    pub(crate) start_time: Option<String>,
}
