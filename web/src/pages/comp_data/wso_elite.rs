use super::{
    format::format_us_date,
    loading::{Load, LoadState, load_error, load_query},
    ui::{DataMetric, DataPage, DataStatus, DataTable, EmptyTableRow, FilterSelect, TableSkeleton},
};
use crate::utils::api::{actions, premium_action, queries};
use leptos::prelude::*;
use serde::{Deserialize, Serialize};
use std::{borrow::Cow, collections::HashMap};

/// What an elite list ranks by, as `results:wsoElite` names it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "camelCase")]
enum Method {
    PercentA,
    Qpoints,
    Qmasters,
    Sinclair,
}

impl Method {
    fn value(self) -> &'static str {
        match self {
            Method::PercentA => "percentA",
            Method::Qpoints => "qpoints",
            Method::Qmasters => "qmasters",
            Method::Sinclair => "sinclair",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        [
            Method::PercentA,
            Method::Qpoints,
            Method::Qmasters,
            Method::Sinclair,
        ]
        .into_iter()
        .find(|method| method.value() == value)
    }

    fn label(self) -> &'static str {
        match self {
            Method::PercentA => "% of A standard",
            Method::Qpoints => "Q-points",
            Method::Qmasters => "Q-masters",
            Method::Sinclair => "Sinclair",
        }
    }

    /// A score as the tables show it: a percentage to one decimal, points to two.
    fn score(self, value: f64) -> String {
        match self {
            Method::PercentA => format!("{value:.1}%"),
            _ => format!("{value:.2}"),
        }
    }
}

/// The lists, in the order they show, with what each may be scored by (its
/// default first): the server's `ELITE_METHOD_CHOICES` (`convex/lib/elite.ts`).
const LISTS: [(&str, &str, &[Method]); 5] = [
    (
        "overall",
        "Overall",
        &[Method::PercentA, Method::Sinclair, Method::Qpoints],
    ),
    ("youth", "Youth", &[Method::PercentA, Method::Sinclair]),
    (
        "junior",
        "Junior",
        &[Method::PercentA, Method::Qpoints, Method::Sinclair],
    ),
    (
        "senior",
        "Senior",
        &[Method::PercentA, Method::Qpoints, Method::Sinclair],
    ),
    (
        "masters",
        "Masters",
        &[Method::Qmasters, Method::PercentA, Method::Sinclair],
    ),
];

/// What a list's Q-points choice means there, where it differs from plain Q-points.
fn choice_label(list: &str, method: Method) -> &'static str {
    match (list, method) {
        ("overall", Method::Qpoints) => "Q-points (Masters: Q-masters)",
        ("masters", Method::PercentA) => "% of Senior A standard",
        _ => method.label(),
    }
}

/// The method each list is shown by: a list's picker switches between the
/// rankings the answer already holds, so it never asks again.
#[derive(Clone, Debug, PartialEq)]
struct Methods {
    overall: Method,
    youth: Method,
    junior: Method,
    senior: Method,
    masters: Method,
}

impl Default for Methods {
    fn default() -> Self {
        Self {
            overall: LISTS[0].2[0],
            youth: LISTS[1].2[0],
            junior: LISTS[2].2[0],
            senior: LISTS[3].2[0],
            masters: LISTS[4].2[0],
        }
    }
}

impl Methods {
    fn get(&self, list: &str) -> Method {
        match list {
            "youth" => self.youth,
            "junior" => self.junior,
            "senior" => self.senior,
            "masters" => self.masters,
            _ => self.overall,
        }
    }

    fn set(&mut self, list: &str, method: Method) {
        match list {
            "youth" => self.youth = method,
            "junior" => self.junior = method,
            "senior" => self.senior = method,
            "masters" => self.masters = method,
            _ => self.overall = method,
        }
    }
}

/// The action's arguments: without `methods`, its `lists` take each list's
/// default, and the page reads `rankings`, which holds every method.
#[derive(Clone, Debug, PartialEq, Serialize)]
struct EliteQuery {
    wso: String,
    from: String,
    to: String,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
struct EliteRow {
    name: String,
    date: String,
    meet: String,
    division: String,
    group: String,
    age: i64,
    body_weight: f64,
    snatch_best: f64,
    cj_best: f64,
    total: f64,
    score: f64,
    #[serde(default)]
    weight_class: Option<String>,
    #[serde(default)]
    standard_a: Option<f64>,
}

/// One list ranked by one method.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
struct EliteRanking {
    men: Vec<EliteRow>,
    women: Vec<EliteRow>,
}

/// Every list by every method it offers (the action's `rankings`).
#[derive(Clone, Debug, PartialEq, Deserialize)]
struct EliteRankings {
    overall: HashMap<Method, EliteRanking>,
    youth: HashMap<Method, EliteRanking>,
    junior: HashMap<Method, EliteRanking>,
    senior: HashMap<Method, EliteRanking>,
    masters: HashMap<Method, EliteRanking>,
}

impl EliteRankings {
    fn of(&self, list: &str) -> &HashMap<Method, EliteRanking> {
        match list {
            "youth" => &self.youth,
            "junior" => &self.junior,
            "senior" => &self.senior,
            "masters" => &self.masters,
            _ => &self.overall,
        }
    }

    /// Each list, in `LISTS` order, by the method `methods` picks for it;
    /// empty when the answer lacks that method.
    fn shown<'a>(
        &'a self,
        methods: &Methods,
    ) -> Vec<(&'static str, &'static str, Method, Cow<'a, EliteRanking>)> {
        LISTS
            .iter()
            .map(|(key, label, _)| {
                let method = methods.get(key);
                let ranking = self
                    .of(key)
                    .get(&method)
                    .map_or_else(|| Cow::Owned(EliteRanking::default()), Cow::Borrowed);
                (*key, *label, method, ranking)
            })
            .collect()
    }
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
struct EliteAnswer {
    wso: String,
    from: String,
    to: String,
    members: i64,
    rankings: EliteRankings,
}

/// The default range: last calendar year.
fn last_year() -> (String, String) {
    let year = js_sys::Date::new_0().get_full_year() - 1;
    (format!("{year:04}-01-01"), format!("{year:04}-12-31"))
}

/// Ages each group covers, as the server's `groupOfAge` splits them.
const GROUP_HELP: &str = "Youth 17 and under, Junior 18–20, Senior 21–34, Masters 35 and over, by weightlifting age in the result’s year.";

#[component]
pub fn WsoElite() -> impl IntoView {
    let (request, set_request) = signal(None::<EliteQuery>);
    let methods = RwSignal::new(Methods::default());
    let wsos = load_query::<Vec<String>>(queries::REGISTRATION_WSOS);
    let answer = Load::new(
        move || request.get(),
        |request| async move {
            let Some(request) = request else {
                return Ok(None);
            };
            premium_action::<EliteAnswer, _>(actions::WSO_ELITE, &request)
                .await
                .map(Some)
                .map_err(|error| error.to_string())
        },
    );

    view! {
        <DataPage
            heading="WSO Elite"
            intro="Find a WSO’s top 20 women and men overall and in each age group, scored by % of A standard, Q-points, Q-masters, or Sinclair."
        >
            {move || wsos.with(|state| match state {
                LoadState::Ready(wsos) => view! {
                    <EliteForm
                        wsos=wsos.clone()
                        submit=Callback::new(move |query| answer.submit(|| set_request.set(Some(query))))
                        methods
                    />
                }.into_any(),
                LoadState::Failed(error) => load_error("WSOs", error, move || wsos.retry()),
                LoadState::Loading => view! { <DataStatus message="Loading WSOs…" /> }.into_any(),
            })}
            <p class="data-help">
                "An athlete counts for the WSO named on their most recent meet registration that names one; every USAW result of theirs in the range counts. "
                {GROUP_HELP}
                " % of A uses the A standard for the class the bodyweight falls in today (Masters against Senior); Q-masters is Q-points times Huebner’s 2025 age factor."
            </p>
            {move || if request.with(Option::is_none) {
                view! { <DataStatus message="Choose a WSO to view its elite athletes." /> }.into_any()
            } else {
                answer.with(|state| match state {
                    LoadState::Loading => view! { <DataStatus message="Ranking the WSO’s athletes… this can take up to a minute." /><TableSkeleton columns=10 /> }.into_any(),
                    LoadState::Failed(error) => load_error("the elite lists", error, move || answer.retry()),
                    LoadState::Ready(None) => ().into_any(),
                    LoadState::Ready(Some(answer)) => methods.with(|methods| elite_lists(answer, methods)),
                })
            }}
        </DataPage>
    }
}

#[component]
fn EliteForm(
    wsos: Vec<String>,
    submit: Callback<EliteQuery>,
    methods: RwSignal<Methods>,
) -> impl IntoView {
    let (default_from, default_to) = last_year();
    let (wso, set_wso) = signal(String::new());
    let (from, set_from) = signal(default_from);
    let (to, set_to) = signal(default_to);

    let pickers = LISTS
        .iter()
        .map(|(key, label, choices)| {
            let key = *key;
            let options = choices
                .iter()
                .map(|method| {
                    view! { <option value=method.value() selected=*method == choices[0]>{choice_label(key, *method)}</option> }
                })
                .collect_view();
            view! {
                <label>
                    {format!("{label} score")}
                    <select
                        class="data-filter"
                        prop:value=move || methods.with(|methods| methods.get(key).value())
                        on:change=move |event| {
                            if let Some(method) = Method::parse(&event_target_value(&event)) {
                                methods.update(|methods| methods.set(key, method));
                            }
                        }
                    >
                        {options}
                    </select>
                </label>
            }
        })
        .collect_view();

    view! {
        <form class="data-query-form" on:submit=move |event| {
            event.prevent_default();
            let chosen = wso.get();
            if !chosen.is_empty() {
                submit.run(EliteQuery { wso: chosen, from: from.get(), to: to.get() });
            }
        }>
            <div class="data-filters">
                <FilterSelect label="WSO" placeholder="Choose a WSO" values=wsos selected=wso wide=true on_select=move |value| set_wso.set(value) />
            </div>
            <label>"From"<input class="data-filter" type="date" required=true prop:value=move || from.get() on:input=move |event| set_from.set(event_target_value(&event)) /></label>
            <label>"To"<input class="data-filter" type="date" required=true prop:value=move || to.get() on:input=move |event| set_to.set(event_target_value(&event)) /></label>
            <button class="data-search-button" type="submit">"View elite lists"</button>
        </form>
        <div class="data-query-form elite-scores">{pickers}</div>
    }
}

fn elite_lists(answer: &EliteAnswer, methods: &Methods) -> AnyView {
    let shown = answer.rankings.shown(methods);
    let csv = elite_csv(&shown);
    let href = format!(
        "data:text/csv;charset=utf-8,{}",
        String::from(js_sys::encode_uri_component(&csv))
    );
    let file = format!(
        "{}-elite-{}-to-{}.csv",
        file_slug(&answer.wso),
        answer.from,
        answer.to
    );
    let sections = shown
        .iter()
        .map(|(key, label, method, ranking)| {
            let heading = format!("{label} — {}", choice_label(key, *method));
            view! {
                <h2 class="data-section-title">{heading}</h2>
                <h3 class="elite-gender">"Women"</h3>
                {elite_table(&ranking.women, *method)}
                <h3 class="elite-gender">"Men"</h3>
                {elite_table(&ranking.men, *method)}
            }
        })
        .collect_view();
    view! {
        <div class="data-metric-grid">
            <DataMetric label="WSO athletes" value=answer.members.to_string() />
            <DataMetric label="Range" value=format!("{} – {}", format_us_date(&answer.from), format_us_date(&answer.to)) />
        </div>
        <p><a class="data-retry-button elite-download" href=href download=file>"Download CSV"</a></p>
        {sections}
    }
    .into_any()
}

const COLUMNS: usize = 10;

fn elite_table(rows: &[EliteRow], method: Method) -> AnyView {
    let body = rows
        .iter()
        .zip(1..)
        .map(|(row, rank)| {
            let standard = match (&row.weight_class, row.standard_a) {
                (Some(class), Some(standard)) => format!("{standard} ({class})"),
                _ => "—".to_owned(),
            };
            view! {
                <tr>
                    <td>{rank}</td>
                    <td>{row.name.clone()}</td>
                    <td>{format!("{} ({})", capitalized(&row.group), row.age)}</td>
                    <td>{row.body_weight}</td>
                    <td>{row.snatch_best}</td>
                    <td>{row.cj_best}</td>
                    <td>{row.total}</td>
                    <td><strong>{method.score(row.score)}</strong></td>
                    <td>{standard}</td>
                    <td>{format!("{} · {}", format_us_date(&row.date), row.meet)}</td>
                </tr>
            }
        })
        .collect_view();
    let empty = rows
        .is_empty()
        .then(|| view! { <EmptyTableRow columns=COLUMNS message="No results in this range." /> });
    view! {
        <DataTable>
            <thead><tr><th>"Rank"</th><th>"Athlete"</th><th>"Group (age)"</th><th>"BW"</th><th>"Snatch"</th><th>"C&J"</th><th>"Total"</th><th>"Score"</th><th>"A standard"</th><th>"Result"</th></tr></thead>
            <tbody>{empty}{body}</tbody>
        </DataTable>
    }
    .into_any()
}

fn capitalized(value: &str) -> String {
    let mut chars = value.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

/// A WSO name as a file name: letters and digits, runs of anything else as one dash.
fn file_slug(value: &str) -> String {
    let lower = value.to_lowercase();
    let words: Vec<&str> = lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect();
    if words.is_empty() {
        "wso".to_owned()
    } else {
        words.join("-")
    }
}

/// One CSV cell: quoted when it holds a comma, quote or line break.
fn csv_cell(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_owned()
    }
}

/// The lists shown, as one CSV: a line per ranked athlete, with the list, gender and method.
fn elite_csv(shown: &[(&str, &str, Method, Cow<'_, EliteRanking>)]) -> String {
    let mut lines = vec![
        "list,gender,rank,athlete,group,age,body_weight,snatch,cj,total,method,score,weight_class,standard_a,date,meet"
            .to_owned(),
    ];
    for (key, _, method, ranking) in shown {
        for (gender, rows) in [("women", &ranking.women), ("men", &ranking.men)] {
            for (rank, row) in (1..).zip(rows) {
                let cells = [
                    (*key).to_owned(),
                    gender.to_owned(),
                    rank.to_string(),
                    row.name.clone(),
                    row.group.clone(),
                    row.age.to_string(),
                    row.body_weight.to_string(),
                    row.snatch_best.to_string(),
                    row.cj_best.to_string(),
                    row.total.to_string(),
                    method.value().to_owned(),
                    format!("{:.2}", row.score),
                    row.weight_class.clone().unwrap_or_default(),
                    row.standard_a
                        .map(|value| value.to_string())
                        .unwrap_or_default(),
                    row.date.clone(),
                    row.meet.clone(),
                ];
                lines.push(
                    cells
                        .iter()
                        .map(|cell| csv_cell(cell))
                        .collect::<Vec<_>>()
                        .join(","),
                );
            }
        }
    }
    lines.join("\n") + "\n"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(name: &str, score: f64) -> EliteRow {
        EliteRow {
            name: name.to_owned(),
            date: "2025-03-01".to_owned(),
            meet: "Spring Open, Raleigh".to_owned(),
            division: "Open Women's 63kg".to_owned(),
            group: "senior".to_owned(),
            age: 26,
            body_weight: 62.4,
            snatch_best: 90.0,
            cj_best: 110.0,
            total: 200.0,
            score,
            weight_class: Some("63kg".to_owned()),
            standard_a: Some(200.0),
        }
    }

    fn ranking(women: Vec<EliteRow>) -> EliteRanking {
        EliteRanking { men: vec![], women }
    }

    fn rankings() -> EliteRankings {
        let only = |method, women| HashMap::from([(method, ranking(women))]);
        EliteRankings {
            overall: HashMap::from([
                (Method::PercentA, ranking(vec![row("Ada", 100.0)])),
                (Method::Sinclair, ranking(vec![row("Ada", 262.1)])),
            ]),
            youth: only(Method::PercentA, vec![]),
            junior: only(Method::PercentA, vec![]),
            senior: only(Method::Sinclair, vec![row("Ada \"Lift\"", 251.236)]),
            masters: only(Method::Qmasters, vec![]),
        }
    }

    #[test]
    fn sends_only_the_wso_and_range() {
        let query = EliteQuery {
            wso: "Carolina".to_owned(),
            from: "2025-01-01".to_owned(),
            to: "2025-12-31".to_owned(),
        };
        assert_eq!(
            serde_json::to_value(query).unwrap(),
            serde_json::json!({ "wso": "Carolina", "from": "2025-01-01", "to": "2025-12-31" })
        );
    }

    #[test]
    fn reads_the_actions_rankings() {
        let ada = serde_json::json!({
            "name": "Ada", "date": "2025-03-01", "meet": "M", "division": "Open Women's 63kg", "gender": "Women",
            "group": "senior", "age": 26, "body_weight": 62.4, "snatch_best": 90, "cj_best": 110, "total": 200,
            "score": 100, "weight_class": "63kg", "standard_a": 200
        });
        let bea = serde_json::json!({
            "name": "Bea", "date": "2025-04-01", "meet": "M", "division": "Masters", "gender": "Women",
            "group": "masters", "age": 46, "body_weight": 62, "snatch_best": 60, "cj_best": 80, "total": 140,
            "score": 260.5, "weight_class": null, "standard_a": null
        });
        let empty = serde_json::json!({ "men": [], "women": [] });
        let value = serde_json::json!({
            "wso": "Carolina", "from": "2025-01-01", "to": "2025-12-31", "members": 1,
            "lists": { "overall": { "method": "percentA", "men": [], "women": [ada] } },
            "rankings": {
                "overall": { "percentA": { "men": [], "women": [ada] }, "sinclair": empty, "qpoints": empty },
                "youth": { "percentA": empty, "sinclair": empty },
                "junior": { "percentA": empty, "qpoints": empty, "sinclair": empty },
                "senior": { "percentA": empty, "qpoints": empty, "sinclair": empty },
                "masters": { "qmasters": { "men": [], "women": [bea] }, "percentA": empty, "sinclair": empty }
            }
        });
        let answer: EliteAnswer = serde_json::from_value(value).unwrap();
        assert_eq!(answer.rankings.overall.len(), 3);
        assert_eq!(
            answer.rankings.overall[&Method::PercentA].women[0].standard_a,
            Some(200.0)
        );
        assert_eq!(
            answer.rankings.masters[&Method::Qmasters].women[0].weight_class,
            None
        );
    }

    #[test]
    fn shows_each_list_by_its_picked_method() {
        let rankings = rankings();
        let mut methods = Methods::default();
        assert_eq!(rankings.shown(&methods)[0].3.women[0].score, 100.0);
        methods.set("overall", Method::Sinclair);
        let shown = rankings.shown(&methods);
        assert_eq!(
            (shown[0].2, shown[0].3.women[0].score),
            (Method::Sinclair, 262.1)
        );
        // A method the answer lacks shows an empty list.
        methods.set("overall", Method::Qpoints);
        assert!(rankings.shown(&methods)[0].3.women.is_empty());
    }

    #[test]
    fn writes_the_shown_lists_to_one_csv_quoting_where_needed() {
        let rankings = rankings();
        let mut methods = Methods::default();
        methods.set("senior", Method::Sinclair);
        let csv = elite_csv(&rankings.shown(&methods));
        let lines: Vec<&str> = csv.lines().collect();
        assert_eq!(lines.len(), 3);
        assert!(lines[0].starts_with("list,gender,rank,athlete"));
        assert_eq!(
            lines[1],
            "overall,women,1,Ada,senior,26,62.4,90,110,200,percentA,100.00,63kg,200,2025-03-01,\"Spring Open, Raleigh\""
        );
        assert!(lines[2].starts_with("senior,women,1,\"Ada \"\"Lift\"\"\",senior,26,"));
        assert!(lines[2].contains(",sinclair,251.24,"));
    }

    #[test]
    fn shows_scores_and_names_files() {
        assert_eq!(Method::PercentA.score(98.345), "98.3%");
        assert_eq!(Method::Sinclair.score(251.236), "251.24");
        assert_eq!(
            file_slug("California North Central"),
            "california-north-central"
        );
        assert_eq!(file_slug("  "), "wso");
        assert_eq!(
            choice_label("overall", Method::Qpoints),
            "Q-points (Masters: Q-masters)"
        );
        assert_eq!(
            choice_label("masters", Method::PercentA),
            "% of Senior A standard"
        );
        assert_eq!(Method::parse("qmasters"), Some(Method::Qmasters));
        assert_eq!(Method::parse("nope"), None);
    }

    #[test]
    fn defaults_match_the_servers() {
        let defaults = Methods::default();
        for (key, _, choices) in LISTS {
            assert_eq!(defaults.get(key), choices[0]);
        }
        assert_eq!(defaults.masters, Method::Qmasters);
    }
}
