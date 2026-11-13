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
    #[serde(default)]
    pub(crate) lifter_id: Option<String>,
    #[serde(default)]
    pub(crate) sole_lifter_id: Option<String>,
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

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
pub(crate) struct ByLift<T> {
    pub(crate) snatch: T,
    pub(crate) cj: T,
    pub(crate) total: T,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
pub(crate) struct PrMarks {
    pub(crate) set: ByLift<Vec<usize>>,
    pub(crate) current: ByLift<Option<usize>>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub(crate) struct LifterCard {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub(crate) struct LifterChoice {
    #[serde(flatten)]
    pub(crate) lifter: LifterCard,
    pub(crate) results: f64,
    pub(crate) latest_date: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(crate) enum AthleteAnswer {
    Results {
        lifter: Option<LifterCard>,
        json: String,
        prs: PrMarks,
    },
    Choose {
        name: String,
        lifters: Vec<LifterChoice>,
        other_results: f64,
    },
}
