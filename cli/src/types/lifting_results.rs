use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
pub struct LiftingResults {
    pub(crate) federation: String,
    pub(crate) meet: String,
    pub(crate) date: String,
    pub(crate) name: String,
    pub age: String,
    pub(crate) body_weight: f64,
    pub(crate) snatch1: f64,
    pub(crate) snatch2: f64,
    pub(crate) snatch3: f64,
    pub(crate) snatch_best: f64,
    pub(crate) cj1: f64,
    pub(crate) cj2: f64,
    pub(crate) cj3: f64,
    pub(crate) cj_best: f64,
    pub(crate) total: f64,
    pub(crate) adaptive: bool,
}

#[derive(Debug, Deserialize, Clone)]
pub(crate) struct AdaptiveRecord {
    pub(crate) weight_class: String,
    pub(crate) snatch: f64,
    pub(crate) cj: f64,
    pub(crate) total: f64,
}

pub(crate) struct PRs {
    pub(crate) snatch_best: f64,
    pub(crate) cj_best: f64,
    pub(crate) total_best: f64,
}
