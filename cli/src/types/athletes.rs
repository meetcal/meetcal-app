use clap::ValueEnum;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct Athletes {
    pub adaptive: bool,
    pub age: f64,
    pub club: String,
    pub entry_total: f64,
    pub gender: String,
    pub meet: String,
    pub member_id: String,
    pub name: String,
    pub session_number: Option<f64>,
    pub session_platform: Option<Platform>,
    pub weight_class: String,
    pub wso: Option<String>,
}

#[derive(Debug, Clone, ValueEnum, Deserialize)]
pub enum Platform {
    Red,
    White,
    Blue,
    Stars,
    Stripes,
    Rogue,
}
