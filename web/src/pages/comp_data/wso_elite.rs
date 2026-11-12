use super::{
    address::{HistoryEntry, query_param, use_page_address},
    format::{NO_VALUE, format_us_date},
    loading::{Load, LoadState, load_error, load_query},
    ui::{DataMetric, DataPage, DataStatus, DataTable, EmptyTableRow, FilterSelect, TableSkeleton},
};
use crate::utils::api::{actions, premium_action, queries};
use crate::utils::text::capitalize_first;
use leptos::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EliteList {
    Overall,
    Youth,
    Junior,
    Senior,
    Masters,
}

impl EliteList {
    const IN_PAGE_ORDER: [Self; 5] = [
        Self::Overall,
        Self::Youth,
        Self::Junior,
        Self::Senior,
        Self::Masters,
    ];

    fn key(self) -> &'static str {
        match self {
            Self::Overall => "overall",
            Self::Youth => "youth",
            Self::Junior => "junior",
            Self::Senior => "senior",
            Self::Masters => "masters",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Overall => "Overall",
            Self::Youth => "Youth",
            Self::Junior => "Junior",
            Self::Senior => "Senior",
            Self::Masters => "Masters",
        }
    }

    fn methods_default_first(self) -> &'static [Method] {
        match self {
            Self::Overall => &[Method::PercentA, Method::Sinclair, Method::Qpoints],
            Self::Youth => &[Method::PercentA, Method::Sinclair],
            Self::Junior | Self::Senior => &[Method::PercentA, Method::Qpoints, Method::Sinclair],
            Self::Masters => &[Method::Qmasters, Method::PercentA, Method::Sinclair],
        }
    }

    fn default_method(self) -> Method {
        self.methods_default_first()[0]
    }
}

fn choice_label(list: EliteList, method: Method) -> &'static str {
    match (list, method) {
        (EliteList::Overall, Method::Qpoints) => "Q-points (Masters: Q-masters)",
        (EliteList::Masters, Method::PercentA) => "% of Senior A standard",
        _ => method.label(),
    }
}

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
            overall: EliteList::Overall.default_method(),
            youth: EliteList::Youth.default_method(),
            junior: EliteList::Junior.default_method(),
            senior: EliteList::Senior.default_method(),
            masters: EliteList::Masters.default_method(),
        }
    }
}

impl Methods {
    fn get(&self, list: EliteList) -> Method {
        match list {
            EliteList::Overall => self.overall,
            EliteList::Youth => self.youth,
            EliteList::Junior => self.junior,
            EliteList::Senior => self.senior,
            EliteList::Masters => self.masters,
        }
    }

    fn set(&mut self, list: EliteList, method: Method) {
        match list {
            EliteList::Overall => self.overall = method,
            EliteList::Youth => self.youth = method,
            EliteList::Junior => self.junior = method,
            EliteList::Senior => self.senior = method,
            EliteList::Masters => self.masters = method,
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

type RankingsByMethodName = HashMap<String, EliteRanking>;

#[derive(Clone, Debug, PartialEq, Deserialize)]
struct EliteRankings {
    overall: RankingsByMethodName,
    youth: RankingsByMethodName,
    junior: RankingsByMethodName,
    senior: RankingsByMethodName,
    masters: RankingsByMethodName,
}

type ShownList<'a> = (EliteList, Method, Option<&'a EliteRanking>);

impl EliteRankings {
    fn of(&self, list: EliteList) -> &RankingsByMethodName {
        match list {
            EliteList::Overall => &self.overall,
            EliteList::Youth => &self.youth,
            EliteList::Junior => &self.junior,
            EliteList::Senior => &self.senior,
            EliteList::Masters => &self.masters,
        }
    }

    fn shown<'a>(&'a self, methods: &Methods) -> Vec<ShownList<'a>> {
        EliteList::IN_PAGE_ORDER
            .into_iter()
            .map(|list| {
                let method = methods.get(list);
                (list, method, self.of(list).get(method.value()))
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

fn calendar_year(year: u32) -> (String, String) {
    (format!("{year:04}-01-01"), format!("{year:04}-12-31"))
}

fn this_year() -> (String, String) {
    calendar_year(js_sys::Date::new_0().get_full_year())
}

/// Ages each group covers, as the server's `groupOfAge` splits them.
const GROUP_HELP: &str = "Youth 17 and under, Junior 18–20, Senior 21–34, Masters 35 and over, by weightlifting age in the result’s year.";

#[component]
pub fn WsoElite() -> impl IntoView {
    let page = use_page_address("/wso-elite");
    let wso_in_address = query_param("wso");
    let from_in_address = query_param("from");
    let to_in_address = query_param("to");
    let request = Memo::new(move |_| {
        elite_request(
            &wso_in_address.get(),
            &from_in_address.get(),
            &to_in_address.get(),
            this_year(),
        )
    });
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
                        shown=request
                        submit=Callback::new(move |query: EliteQuery| {
                            if request.get_untracked().as_ref() == Some(&query) {
                                answer.retry();
                            } else {
                                page.show(
                                    &[("wso", &query.wso), ("from", &query.from), ("to", &query.to)],
                                    HistoryEntry::Push,
                                );
                            }
                        })
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

fn is_calendar_date_text(value: &str) -> bool {
    value.len() == 10
        && value.bytes().enumerate().all(|(index, byte)| {
            if index == 4 || index == 7 {
                byte == b'-'
            } else {
                byte.is_ascii_digit()
            }
        })
}

fn elite_request(
    wso: &str,
    from: &str,
    to: &str,
    default_range: (String, String),
) -> Option<EliteQuery> {
    if wso.is_empty() {
        return None;
    }
    let (default_from, default_to) = default_range;
    Some(EliteQuery {
        wso: wso.to_owned(),
        from: if is_calendar_date_text(from) {
            from.to_owned()
        } else {
            default_from
        },
        to: if is_calendar_date_text(to) {
            to.to_owned()
        } else {
            default_to
        },
    })
}

fn form_range(shown: Option<&EliteQuery>) -> (String, String, String) {
    match shown {
        Some(shown) => (shown.wso.clone(), shown.from.clone(), shown.to.clone()),
        None => {
            let (from, to) = this_year();
            (String::new(), from, to)
        }
    }
}

#[component]
fn EliteForm(
    wsos: Vec<String>,
    shown: Memo<Option<EliteQuery>>,
    submit: Callback<EliteQuery>,
    methods: RwSignal<Methods>,
) -> impl IntoView {
    let (first_wso, first_from, first_to) =
        shown.with_untracked(|shown| form_range(shown.as_ref()));
    let (wso, set_wso) = signal(first_wso);
    let (from, set_from) = signal(first_from);
    let (to, set_to) = signal(first_to);
    Effect::new(move |earlier: Option<()>| {
        let (shown_wso, shown_from, shown_to) = shown.with(|shown| form_range(shown.as_ref()));
        if earlier.is_some() {
            set_wso.set(shown_wso);
            set_from.set(shown_from);
            set_to.set(shown_to);
        }
    });

    let pickers = EliteList::IN_PAGE_ORDER
        .into_iter()
        .map(|list| {
            let options = list
                .methods_default_first()
                .iter()
                .map(|method| {
                    view! { <option value=method.value() selected=*method == list.default_method()>{choice_label(list, *method)}</option> }
                })
                .collect_view();
            view! {
                <label>
                    {format!("{} score", list.label())}
                    <select
                        class="data-filter"
                        prop:value=move || methods.with(|methods| methods.get(list).value())
                        on:change=move |event| {
                            if let Some(method) = Method::parse(&event_target_value(&event)) {
                                methods.update(|methods| methods.set(list, method));
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
        .map(|(list, method, ranking)| {
            let heading = format!("{} — {}", list.label(), choice_label(*list, *method));
            let tables = match ranking {
                Some(ranking) => view! {
                    <h3 class="elite-gender">"Women"</h3>
                    {elite_table(&ranking.women, *method)}
                    <h3 class="elite-gender">"Men"</h3>
                    {elite_table(&ranking.men, *method)}
                }
                .into_any(),
                None => view! { <p class="data-status">{SCORE_NOT_IN_ANSWER}</p> }.into_any(),
            };
            view! {
                <h2 class="data-section-title">{heading}</h2>
                {tables}
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

const SCORE_NOT_IN_ANSWER: &str = "This score isn’t available for this list right now.";

const COLUMNS: usize = 10;

fn elite_table(rows: &[EliteRow], method: Method) -> AnyView {
    let body = rows
        .iter()
        .zip(1..)
        .map(|(row, rank)| {
            let standard = match (&row.weight_class, row.standard_a) {
                (Some(class), Some(standard)) => format!("{standard} ({class})"),
                _ => NO_VALUE.to_owned(),
            };
            view! {
                <tr>
                    <td>{rank}</td>
                    <td>{row.name.clone()}</td>
                    <td>{format!("{} ({})", capitalize_first(&row.group), row.age)}</td>
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

fn elite_csv(shown: &[ShownList<'_>]) -> String {
    let mut lines = vec![
        "list,gender,rank,athlete,group,age,body_weight,snatch,cj,total,method,score,weight_class,standard_a,date,meet"
            .to_owned(),
    ];
    for (list, method, ranking) in shown {
        let Some(ranking) = ranking else {
            continue;
        };
        for (gender, rows) in [("women", &ranking.women), ("men", &ranking.men)] {
            for (rank, row) in (1..).zip(rows) {
                let cells = [
                    list.key().to_owned(),
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

    #[test]
    fn a_calendar_year_runs_from_new_years_day_to_new_years_eve() {
        assert_eq!(
            calendar_year(2026),
            ("2026-01-01".to_owned(), "2026-12-31".to_owned())
        );
    }

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
        let only =
            |method: Method, women| HashMap::from([(method.value().to_owned(), ranking(women))]);
        EliteRankings {
            overall: HashMap::from([
                ("percentA".to_owned(), ranking(vec![row("Ada", 100.0)])),
                ("sinclair".to_owned(), ranking(vec![row("Ada", 262.1)])),
            ]),
            youth: only(Method::PercentA, vec![]),
            junior: only(Method::PercentA, vec![]),
            senior: only(Method::Sinclair, vec![row("Ada \"Lift\"", 251.236)]),
            masters: only(Method::Qmasters, vec![]),
        }
    }

    #[test]
    fn an_address_names_the_elite_lists_it_opens() {
        let last = || ("2025-01-01".to_owned(), "2025-12-31".to_owned());
        assert_eq!(elite_request("", "2024-01-01", "2024-12-31", last()), None);
        assert_eq!(
            elite_request("Carolina", "2024-02-01", "2024-11-30", last()),
            Some(EliteQuery {
                wso: "Carolina".to_owned(),
                from: "2024-02-01".to_owned(),
                to: "2024-11-30".to_owned()
            })
        );
        assert_eq!(
            elite_request("Carolina", "", "yesterday", last()),
            Some(EliteQuery {
                wso: "Carolina".to_owned(),
                from: "2025-01-01".to_owned(),
                to: "2025-12-31".to_owned()
            })
        );
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
            answer.rankings.overall["percentA"].women[0].standard_a,
            Some(200.0)
        );
        assert_eq!(
            answer.rankings.masters["qmasters"].women[0].weight_class,
            None
        );
    }

    #[test]
    fn shows_each_list_by_its_picked_method() {
        let rankings = rankings();
        let mut methods = Methods::default();
        let women = |list: &ShownList<'_>| list.2.map(|ranking| ranking.women.clone());
        assert_eq!(women(&rankings.shown(&methods)[0]).unwrap()[0].score, 100.0);
        methods.set(EliteList::Overall, Method::Sinclair);
        let shown = rankings.shown(&methods);
        assert_eq!(
            (shown[0].1, women(&shown[0]).unwrap()[0].score),
            (Method::Sinclair, 262.1)
        );
    }

    #[test]
    fn a_picked_method_the_answer_lacks_is_missing_not_an_empty_ranking() {
        let rankings = rankings();
        let mut methods = Methods::default();
        methods.set(EliteList::Overall, Method::Qpoints);
        let shown = rankings.shown(&methods);
        assert_eq!(shown[0].2, None);
        assert_eq!(shown[1].2, Some(&ranking(vec![])));
        assert_eq!(elite_csv(&shown).lines().count(), 1);
    }

    #[test]
    fn a_method_the_page_does_not_know_does_not_make_the_answer_unreadable() {
        let empty = serde_json::json!({ "men": [], "women": [] });
        let lists: EliteRankings = serde_json::from_value(serde_json::json!({
            "overall": { "percentA": empty, "robi": empty },
            "youth": { "percentA": empty },
            "junior": { "percentA": empty },
            "senior": { "percentA": empty },
            "masters": { "qmasters": empty }
        }))
        .unwrap();
        assert!(lists.shown(&Methods::default())[0].2.is_some());
    }

    #[test]
    fn writes_the_shown_lists_to_one_csv_quoting_where_needed() {
        let rankings = rankings();
        let mut methods = Methods::default();
        methods.set(EliteList::Senior, Method::Sinclair);
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
            choice_label(EliteList::Overall, Method::Qpoints),
            "Q-points (Masters: Q-masters)"
        );
        assert_eq!(
            choice_label(EliteList::Masters, Method::PercentA),
            "% of Senior A standard"
        );
        assert_eq!(Method::parse("qmasters"), Some(Method::Qmasters));
        assert_eq!(Method::parse("nope"), None);
    }

    #[test]
    fn each_lists_methods_and_default_are_the_servers() {
        let server = include_str!("../../../../convex/lib/elite.ts");
        let choices = server
            .split_once("export const ELITE_METHOD_CHOICES")
            .and_then(|(_, rest)| rest.split_once("};"))
            .map(|(choices, _)| choices)
            .expect("convex/lib/elite.ts declares ELITE_METHOD_CHOICES");
        for list in EliteList::IN_PAGE_ORDER {
            let line = choices
                .lines()
                .find(|line| line.trim_start().starts_with(&format!("{}:", list.key())))
                .unwrap_or_else(|| panic!("the server has no {} list", list.key()));
            let server_methods = line.split('\'').skip(1).step_by(2).collect::<Vec<_>>();
            let page_methods = list
                .methods_default_first()
                .iter()
                .map(|method| method.value())
                .collect::<Vec<_>>();
            assert_eq!(page_methods, server_methods, "{}", list.key());
            assert_eq!(
                Methods::default().get(list).value(),
                server_methods[0],
                "{}",
                list.key()
            );
        }
    }
}
