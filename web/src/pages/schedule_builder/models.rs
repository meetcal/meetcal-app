use crate::utils::api::{
    Basis, BuilderDay, BuilderEdit, BuilderOptions, Grouping, MeetMatch, ScheduleBase, SessionOrder,
};
use serde::{Deserialize, Serialize};

pub(crate) const MAX_BUILDER_DAYS: usize = 7;
pub(crate) const MAX_BUILDER_PLATFORMS: usize = 6;
pub(crate) const MAX_PLATFORM_NAME_LENGTH: usize = 30;
pub(crate) const MAX_BUILDER_EDITS: usize = 500;
pub(crate) const MINUTES_PER_DAY: u32 = 24 * 60;
pub(crate) const WEIGH_IN_MINUTES: u32 = 120;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Limit {
    pub field: &'static str,
    pub label: &'static str,
    pub min: u32,
    pub max: u32,
}

pub(crate) const SESSION_MINUTES: Limit = Limit {
    field: "sessionMinutes",
    label: "Session length",
    min: 15,
    max: 480,
};
pub(crate) const BREAK_MINUTES: Limit = Limit {
    field: "breakMinutes",
    label: "Break between sessions",
    min: 0,
    max: 240,
};
pub(crate) const MAX_ATHLETES_PER_PLATFORM: Limit = Limit {
    field: "maxAthletesPerPlatform",
    label: "Max athletes per platform",
    min: 1,
    max: 60,
};
pub(crate) const MAX_SESSIONS_PER_DAY: Limit = Limit {
    field: "maxSessionsPerDay",
    label: "Max sessions per day",
    min: 1,
    max: 30,
};

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublishedSchedule {
    pub version: Option<String>,
    pub options: BuilderOptions,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Defaults {
    pub meet: String,
    pub options: BuilderOptions,
    #[serde(default)]
    pub sport80_link: Option<String>,
    #[serde(default)]
    pub published: Option<PublishedSchedule>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub(crate) struct BuilderWarning {
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BuiltAthlete {
    pub key: String,
    pub name: String,
    pub age: f64,
    pub club: String,
    pub weight_class: String,
    pub entry_total: f64,
    #[serde(default)]
    pub withdrawn: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub(crate) struct BoardPlace {
    pub session: u32,
    pub number: u32,
    pub platform: String,
}

impl BoardPlace {
    pub(crate) fn label(&self) -> String {
        format!("Session {} · {}", self.number, self.platform)
    }
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub(crate) struct AddedEntrant {
    pub athlete: BuiltAthlete,
    pub suggestion: Option<BoardPlace>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub(crate) struct WithdrawnAthlete {
    pub athlete: BuiltAthlete,
    pub place: BoardPlace,
    pub occurrence: u32,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Sport80Changes {
    pub checked_at: Option<f64>,
    pub added: Vec<AddedEntrant>,
    pub withdrawn: Vec<WithdrawnAthlete>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BuiltGroup {
    pub platform: String,
    pub label: String,
    pub weight_classes: Vec<String>,
    pub athletes: Vec<BuiltAthlete>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BuiltSession {
    pub id: u32,
    pub number: u32,
    pub date: String,
    pub start_time: String,
    pub weigh_in_time: String,
    pub groups: Vec<BuiltGroup>,
}

impl BuiltSession {
    pub(crate) fn is_scheduled(&self) -> bool {
        !self.start_time.is_empty() && !self.date.is_empty()
    }
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub(crate) struct BuiltSchedule {
    pub athletes: u32,
    pub sessions: Vec<BuiltSession>,
    pub warnings: Vec<BuilderWarning>,
    #[serde(default)]
    pub changes: Option<Sport80Changes>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DraftSummary {
    pub meet: String,
    pub updated_at: f64,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavedDraft {
    pub options: BuilderOptions,
    pub edits: Vec<BuilderEdit>,
    pub basis: Basis,
    pub updated_at: f64,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Publication {
    pub id: String,
    pub status: String,
    pub created_at: f64,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub(crate) struct Publications {
    pub organizer: bool,
    pub publications: Vec<Publication>,
}

pub(crate) fn is_sport80_link(text: &str) -> bool {
    let text = text.trim().to_ascii_lowercase();
    text.starts_with("http://") || text.starts_with("https://") || text.contains("sport80.com/")
}

pub(crate) fn match_details(found: &MeetMatch) -> String {
    use crate::pages::comp_data::format::format_us_date;
    let dates = match (found.start_date.as_str(), found.end_date.as_str()) {
        ("", _) => String::new(),
        (start, end) if end.is_empty() || end == start => format_us_date(start),
        (start, end) => format!("{} – {}", format_us_date(start), format_us_date(end)),
    };
    [dates, found.place.clone()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" · ")
}

pub(crate) fn unbuilt_message(kept_edits: usize, message: &str) -> String {
    if kept_edits == 0 {
        format!("This schedule couldn’t be built: {message}")
    } else {
        format!("This schedule couldn’t be built, so your edits are kept: {message}")
    }
}

pub(crate) fn publication_status_label(status: &str) -> &'static str {
    match status {
        "pending" => "In Review",
        "live" => "Live",
        "approved" => "Approved",
        "rejected" => "Rejected",
        "superseded" => "Replaced",
        "expired" => "Expired",
        _ => "Unknown",
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalWork {
    pub options: BuilderOptions,
    pub edits: Vec<BuilderEdit>,
    #[serde(default)]
    pub basis: Basis,
    pub saved_at: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Start {
    pub options: BuilderOptions,
    pub edits: Vec<BuilderEdit>,
    pub basis: Basis,
    pub built: bool,
    pub set_aside: bool,
}

pub(crate) const SET_ASIDE_NOTICE: &str = "Your saved schedule was made before this meet’s latest publish, so the builder opens on the published schedule.";

pub(crate) fn published_basis(published: &PublishedSchedule) -> Basis {
    Basis {
        base: ScheduleBase::Published,
        base_version: published.version.clone(),
    }
}

pub(crate) fn starting_point(
    defaults: &Defaults,
    draft: Option<SavedDraft>,
    local: Option<LocalWork>,
) -> Start {
    let newest = match (draft, local) {
        (Some(draft), Some(local)) if local.saved_at > draft.updated_at => {
            Some((local.options, local.edits, local.basis))
        }
        (Some(draft), _) => Some((draft.options, draft.edits, draft.basis)),
        (None, Some(local)) => Some((local.options, local.edits, local.basis)),
        (None, None) => None,
    };
    let wanted = defaults
        .published
        .as_ref()
        .map_or_else(Basis::default, published_basis);
    match (newest, defaults.published.as_ref()) {
        (Some((options, edits, basis)), _) if basis == wanted => Start {
            options,
            edits,
            basis,
            built: true,
            set_aside: false,
        },
        (saved, Some(published)) => Start {
            options: published.options.clone(),
            edits: Vec::new(),
            basis: wanted,
            built: true,
            set_aside: saved.is_some(),
        },
        (_, None) => Start {
            options: defaults.options.clone(),
            edits: Vec::new(),
            basis: wanted,
            built: false,
            set_aside: false,
        },
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct FormDay {
    pub date: String,
    pub included: bool,
    pub first_start: String,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct OptionsForm {
    pub days: Vec<FormDay>,
    pub session_minutes: String,
    pub break_minutes: String,
    pub max_athletes_per_platform: String,
    pub max_sessions_per_day: String,
    pub platforms: Vec<String>,
    pub grouping: Grouping,
    pub separate_age_groups: bool,
    pub order: SessionOrder,
}

pub(crate) fn form_of(meet_days: &[BuilderDay], options: &BuilderOptions) -> OptionsForm {
    let mut days = meet_days
        .iter()
        .map(|day| {
            let chosen = options.days.iter().find(|chosen| chosen.date == day.date);
            FormDay {
                date: day.date.clone(),
                included: chosen.is_some(),
                first_start: chosen.unwrap_or(day).first_start.clone(),
            }
        })
        .collect::<Vec<_>>();
    for chosen in &options.days {
        if !days.iter().any(|day| day.date == chosen.date) {
            days.push(FormDay {
                date: chosen.date.clone(),
                included: true,
                first_start: chosen.first_start.clone(),
            });
        }
    }
    days.sort_by(|a, b| a.date.cmp(&b.date));
    OptionsForm {
        days,
        session_minutes: options.session_minutes.to_string(),
        break_minutes: options.break_minutes.to_string(),
        max_athletes_per_platform: options.max_athletes_per_platform.to_string(),
        max_sessions_per_day: options
            .max_sessions_per_day
            .map(|max| max.to_string())
            .unwrap_or_default(),
        platforms: options.platforms.clone(),
        grouping: options.grouping,
        separate_age_groups: options.separate_age_groups,
        order: options.order,
    }
}

fn whole_number(text: &str, limit: Limit) -> Result<u32, String> {
    text.trim()
        .parse::<u32>()
        .ok()
        .filter(|value| (limit.min..=limit.max).contains(value))
        .ok_or_else(|| {
            format!(
                "{} must be a whole number from {} to {}.",
                limit.label, limit.min, limit.max
            )
        })
}

pub(crate) fn minutes_of_clock(text: &str) -> Option<u32> {
    let (hours, minutes) = text.split_once(':')?;
    let all_digits = |part: &str| part.chars().all(|c| c.is_ascii_digit());
    if !(1..=2).contains(&hours.len())
        || minutes.len() != 2
        || !all_digits(hours)
        || !all_digits(minutes)
    {
        return None;
    }
    let hours = hours.parse::<u32>().ok().filter(|hours| *hours <= 23)?;
    let minutes = minutes
        .parse::<u32>()
        .ok()
        .filter(|minutes| *minutes <= 59)?;
    Some(hours * 60 + minutes)
}

pub(crate) fn is_clock(text: &str) -> bool {
    minutes_of_clock(text).is_some()
}

pub(crate) fn checked_options(form: &OptionsForm) -> Result<BuilderOptions, String> {
    use crate::pages::comp_data::format::format_us_date;
    let mut days = Vec::new();
    for day in form.days.iter().filter(|day| day.included) {
        let first_start = day.first_start.trim();
        if !is_clock(first_start) {
            return Err(format!(
                "Enter a first start time for {}.",
                format_us_date(&day.date)
            ));
        }
        days.push(BuilderDay {
            date: day.date.clone(),
            first_start: first_start.to_owned(),
        });
    }
    if days.is_empty() {
        return Err("Choose at least one meet day.".to_owned());
    }
    if days.len() > MAX_BUILDER_DAYS {
        return Err(format!("Choose at most {MAX_BUILDER_DAYS} meet days."));
    }
    let session_minutes = whole_number(&form.session_minutes, SESSION_MINUTES)?;
    let break_minutes = whole_number(&form.break_minutes, BREAK_MINUTES)?;
    let max_athletes_per_platform =
        whole_number(&form.max_athletes_per_platform, MAX_ATHLETES_PER_PLATFORM)?;
    let max_sessions_per_day = if form.max_sessions_per_day.trim().is_empty() {
        None
    } else {
        Some(whole_number(
            &form.max_sessions_per_day,
            MAX_SESSIONS_PER_DAY,
        )?)
    };
    for day in &days {
        let start = minutes_of_clock(&day.first_start).unwrap_or_default();
        if start < WEIGH_IN_MINUTES {
            return Err(format!(
                "The first start on {} leaves no time for its weigh-in {} hours before.",
                format_us_date(&day.date),
                WEIGH_IN_MINUTES / 60
            ));
        }
        if start + session_minutes > MINUTES_PER_DAY {
            return Err(format!(
                "The first session on {} would end after midnight.",
                format_us_date(&day.date)
            ));
        }
    }
    let platforms = form
        .platforms
        .iter()
        .map(|name| name.trim().to_owned())
        .collect::<Vec<_>>();
    if platforms.is_empty() || platforms.len() > MAX_BUILDER_PLATFORMS {
        return Err(format!("Use 1 to {MAX_BUILDER_PLATFORMS} platforms."));
    }
    if platforms.iter().any(String::is_empty) {
        return Err("Name every platform.".to_owned());
    }
    if platforms
        .iter()
        .any(|name| name.chars().count() > MAX_PLATFORM_NAME_LENGTH)
    {
        return Err(format!(
            "Platform names must be {MAX_PLATFORM_NAME_LENGTH} characters or fewer."
        ));
    }
    let mut seen = Vec::<String>::new();
    for name in &platforms {
        let folded = name.to_lowercase();
        if seen.contains(&folded) {
            return Err(format!("Two platforms are named {name}."));
        }
        seen.push(folded);
    }
    Ok(BuilderOptions {
        days,
        session_minutes,
        break_minutes,
        max_athletes_per_platform,
        max_sessions_per_day,
        platforms,
        grouping: form.grouping,
        separate_age_groups: form.separate_age_groups,
        order: form.order,
    })
}

pub(crate) fn new_platform_name(platforms: &[String]) -> String {
    (platforms.len() + 1..)
        .map(|number| format!("Platform {number}"))
        .find(|name| {
            !platforms
                .iter()
                .any(|taken| taken.trim().eq_ignore_ascii_case(name))
        })
        .unwrap_or_default()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct MoveTarget {
    pub session: u32,
    pub platform: String,
    pub label: String,
}

pub(crate) fn place_targets(sessions: &[BuiltSession], platforms: &[String]) -> Vec<MoveTarget> {
    sessions
        .iter()
        .flat_map(|session| {
            platforms.iter().map(move |platform| MoveTarget {
                session: session.id,
                platform: platform.clone(),
                label: format!("Session {} · {platform}", session.number),
            })
        })
        .collect()
}

pub(crate) fn move_targets(
    sessions: &[BuiltSession],
    platforms: &[String],
    from_session: u32,
    from_platform: &str,
) -> Vec<MoveTarget> {
    place_targets(sessions, platforms)
        .into_iter()
        .filter(|target| target.session != from_session || target.platform != from_platform)
        .collect()
}

pub(crate) fn added_note(count: usize) -> String {
    match count {
        0 => "No new lifters.".to_owned(),
        1 => "1 new lifter isn’t placed, so they stay off the start list when you publish.".to_owned(),
        count => format!(
            "{count} new lifters aren’t placed, so they stay off the start list when you publish."
        ),
    }
}

pub(crate) fn withdrawn_note(count: usize) -> &'static str {
    if count == 0 {
        "Every published lifter is still on Sport80."
    } else {
        ""
    }
}

pub(crate) fn rebuild_warning(published: bool, edits: usize) -> String {
    let your_edits = if edits == 1 {
        "your edit".to_owned()
    } else {
        format!("your {edits} edits")
    };
    match (published, edits) {
        (true, 0) => "Rebuilding from scratch regroups every entrant and replaces the published sessions when you publish.".to_owned(),
        (true, _) => format!("Rebuilding from scratch regroups every entrant, replaces the published sessions when you publish, and discards {your_edits}."),
        (false, _) => format!("Building again discards {your_edits}."),
    }
}

pub(crate) fn session_when(session: &BuiltSession) -> String {
    use crate::pages::comp_data::format::{format_us_date, format_us_time};
    if session.is_scheduled() {
        format!(
            "{} · {}",
            format_us_date(&session.date),
            format_us_time(&session.start_time)
        )
    } else {
        "No Time".to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_load_and_anything_else_searches_by_name() {
        for link in [
            "https://usaweightlifting.sport80.com/public/events/15084",
            " HTTPS://usaweightlifting.sport80.com/public/wizard/e/15084 ",
            "usaweightlifting.sport80.com/public/events/15084/entries/21962",
            "https://example.com/meet",
        ] {
            assert!(is_sport80_link(link), "{link}");
        }
        for name in ["Turkey Cup", "  ", "", "sport80", "Https Open"] {
            assert!(!is_sport80_link(name), "{name}");
        }
    }

    #[test]
    fn a_match_reads_its_dates_and_place() {
        let found = MeetMatch {
            event_id: "15084".to_owned(),
            name: "Turkey Cup".to_owned(),
            start_date: "2026-11-21".to_owned(),
            end_date: "2026-11-21".to_owned(),
            place: "Saint Joseph, Missouri".to_owned(),
            entries_url: None,
        };
        assert_eq!(
            match_details(&found),
            "November 21, 2026 · Saint Joseph, Missouri"
        );
        let two_days = MeetMatch {
            end_date: "2026-11-22".to_owned(),
            place: String::new(),
            ..found.clone()
        };
        assert_eq!(
            match_details(&two_days),
            "November 21, 2026 – November 22, 2026"
        );
        let undated = MeetMatch {
            start_date: String::new(),
            end_date: String::new(),
            ..found
        };
        assert_eq!(match_details(&undated), "Saint Joseph, Missouri");
    }

    #[test]
    fn a_refused_build_says_the_edits_are_kept_only_when_there_were_some() {
        assert_eq!(
            unbuilt_message(0, "too late"),
            "This schedule couldn’t be built: too late"
        );
        assert_eq!(
            unbuilt_message(2, "too late"),
            "This schedule couldn’t be built, so your edits are kept: too late"
        );
    }

    fn options() -> BuilderOptions {
        BuilderOptions {
            days: vec![
                BuilderDay {
                    date: "2026-11-14".to_owned(),
                    first_start: "09:00".to_owned(),
                },
                BuilderDay {
                    date: "2026-11-15".to_owned(),
                    first_start: "09:00".to_owned(),
                },
            ],
            session_minutes: 120,
            break_minutes: 0,
            max_athletes_per_platform: 15,
            max_sessions_per_day: None,
            platforms: vec!["Red".to_owned()],
            grouping: Grouping::WeightClass,
            separate_age_groups: true,
            order: SessionOrder::WomenThenMen,
        }
    }

    #[test]
    fn the_limits_are_the_servers() {
        let server = include_str!("../../../../convex/lib/scheduleBuilderOptions.ts");
        for limit in [
            SESSION_MINUTES,
            BREAK_MINUTES,
            MAX_ATHLETES_PER_PLATFORM,
            MAX_SESSIONS_PER_DAY,
        ] {
            let written = format!(
                "{}: {{ min: {}, max: {} }}",
                limit.field, limit.min, limit.max
            );
            assert!(server.contains(&written), "{} differs", limit.field);
        }
        for (name, value) in [
            ("MAX_BUILDER_DAYS", MAX_BUILDER_DAYS),
            ("MAX_BUILDER_PLATFORMS", MAX_BUILDER_PLATFORMS),
            ("MAX_PLATFORM_NAME_LENGTH", MAX_PLATFORM_NAME_LENGTH),
            ("MAX_BUILDER_EDITS", MAX_BUILDER_EDITS),
        ] {
            assert!(
                server.contains(&format!("export const {name} = {value};")),
                "{name} differs"
            );
        }
        assert_eq!(MINUTES_PER_DAY, 24 * 60);
        assert!(server.contains("export const MINUTES_PER_DAY = 24 * 60;"));
        assert_eq!(WEIGH_IN_MINUTES, 120);
        assert!(server.contains("export const WEIGH_IN_MINUTES = 120;"));
        assert!(!server.contains("weighInMinutes"));
    }

    #[test]
    fn a_form_made_from_options_gives_the_same_options_back() {
        let options = options();
        assert_eq!(
            checked_options(&form_of(&options.days, &options)),
            Ok(options)
        );
    }

    #[test]
    fn the_form_lists_every_meet_day_and_marks_the_chosen_ones() {
        let meet_days = options().days;
        let mut chosen = options();
        chosen.days = vec![BuilderDay {
            date: "2026-11-15".to_owned(),
            first_start: "08:30".to_owned(),
        }];
        let form = form_of(&meet_days, &chosen);
        assert_eq!(
            form.days,
            vec![
                FormDay {
                    date: "2026-11-14".to_owned(),
                    included: false,
                    first_start: "09:00".to_owned()
                },
                FormDay {
                    date: "2026-11-15".to_owned(),
                    included: true,
                    first_start: "08:30".to_owned()
                },
            ]
        );
        assert_eq!(checked_options(&form).map(|o| o.days), Ok(chosen.days));
    }

    #[test]
    fn numbers_must_be_whole_and_within_the_limits() {
        let base = form_of(&options().days, &options());
        let mut form = base.clone();
        form.session_minutes = "10".to_owned();
        assert_eq!(
            checked_options(&form),
            Err("Session length must be a whole number from 15 to 480.".to_owned())
        );
        form = base.clone();
        form.max_athletes_per_platform = "7.5".to_owned();
        assert_eq!(
            checked_options(&form),
            Err("Max athletes per platform must be a whole number from 1 to 60.".to_owned())
        );
        form = base.clone();
        form.max_sessions_per_day = " 4 ".to_owned();
        assert_eq!(
            checked_options(&form).map(|o| o.max_sessions_per_day),
            Ok(Some(4))
        );
        form.max_sessions_per_day = "0".to_owned();
        assert!(checked_options(&form).is_err());
    }

    #[test]
    fn days_need_one_chosen_with_a_start_time() {
        let mut form = form_of(&options().days, &options());
        for day in &mut form.days {
            day.included = false;
        }
        assert_eq!(
            checked_options(&form),
            Err("Choose at least one meet day.".to_owned())
        );
        let mut form = form_of(&options().days, &options());
        if let Some(day) = form.days.first_mut() {
            day.first_start = String::new();
        }
        assert_eq!(
            checked_options(&form),
            Err("Enter a first start time for November 14, 2026.".to_owned())
        );
        assert!(is_clock("7:05"));
        assert!(!is_clock("24:00"));
        assert!(!is_clock("09:00:00"));
        assert!(!is_clock("+9:00"));
    }

    #[test]
    fn each_first_start_leaves_room_for_its_weigh_in_and_ends_by_midnight() {
        let mut form = form_of(&options().days, &options());
        if let Some(day) = form.days.get_mut(1) {
            day.first_start = "01:59".to_owned();
        }
        assert_eq!(
            checked_options(&form),
            Err(
                "The first start on November 15, 2026 leaves no time for its weigh-in 2 hours before."
                    .to_owned()
            )
        );
        if let Some(day) = form.days.get_mut(1) {
            day.first_start = "02:00".to_owned();
        }
        assert!(checked_options(&form).is_ok());
        if let Some(day) = form.days.first_mut() {
            day.first_start = "22:01".to_owned();
        }
        assert_eq!(
            checked_options(&form),
            Err("The first session on November 14, 2026 would end after midnight.".to_owned())
        );
        if let Some(day) = form.days.first_mut() {
            day.first_start = "22:00".to_owned();
        }
        assert!(checked_options(&form).is_ok());
        assert_eq!(minutes_of_clock("7:05"), Some(425));
        assert_eq!(minutes_of_clock("23:59"), Some(1439));
    }

    #[test]
    fn platforms_are_trimmed_named_and_distinct() {
        let mut form = form_of(&options().days, &options());
        form.platforms = vec![" Red ".to_owned(), "Blue".to_owned()];
        assert_eq!(
            checked_options(&form).map(|o| o.platforms),
            Ok(vec!["Red".to_owned(), "Blue".to_owned()])
        );
        form.platforms = vec!["Red".to_owned(), "red".to_owned()];
        assert_eq!(
            checked_options(&form),
            Err("Two platforms are named red.".to_owned())
        );
        form.platforms = vec!["  ".to_owned()];
        assert_eq!(
            checked_options(&form),
            Err("Name every platform.".to_owned())
        );
        form.platforms = vec!["x".repeat(31)];
        assert!(checked_options(&form).is_err());
        form.platforms = Vec::new();
        assert_eq!(
            checked_options(&form),
            Err("Use 1 to 6 platforms.".to_owned())
        );
    }

    #[test]
    fn work_saved_with_a_weigh_in_option_still_opens_and_sends_without_it() {
        let saved: LocalWork = serde_json::from_value(serde_json::json!({
            "options": {
                "days": [{ "date": "2026-11-14", "firstStart": "09:00" }],
                "sessionMinutes": 120, "breakMinutes": 0, "weighInMinutes": 90,
                "maxAthletesPerPlatform": 15, "maxSessionsPerDay": null, "platforms": ["Red"],
                "grouping": "weightClass", "separateAgeGroups": true, "order": "womenThenMen"
            },
            "edits": [],
            "savedAt": 1
        }))
        .unwrap();
        let sent = serde_json::to_value(&saved.options).unwrap();
        assert_eq!(sent.get("weighInMinutes"), None);
        assert_eq!(sent.get("sessionMinutes"), Some(&serde_json::json!(120)));
    }

    #[test]
    fn new_platforms_get_a_free_name() {
        assert_eq!(new_platform_name(&["Red".to_owned()]), "Platform 2");
        assert_eq!(
            new_platform_name(&["Red".to_owned(), "platform 3".to_owned()]),
            "Platform 4"
        );
    }

    fn meet_defaults(published: Option<PublishedSchedule>) -> Defaults {
        Defaults {
            meet: "Turkey Cup".to_owned(),
            options: options(),
            sport80_link: None,
            published,
        }
    }

    fn entries_basis() -> Basis {
        Basis::default()
    }

    fn published_on(version: &str) -> Basis {
        Basis {
            base: ScheduleBase::Published,
            base_version: Some(version.to_owned()),
        }
    }

    #[test]
    fn the_newest_saved_work_wins_and_none_starts_unbuilt() {
        let defaults = meet_defaults(None);
        let mut drafted = options();
        drafted.session_minutes = 90;
        let mut local = options();
        local.session_minutes = 100;
        let draft = |at: f64| SavedDraft {
            options: drafted.clone(),
            edits: Vec::new(),
            basis: entries_basis(),
            updated_at: at,
        };
        let work = |at: f64| LocalWork {
            options: local.clone(),
            edits: Vec::new(),
            basis: entries_basis(),
            saved_at: at,
        };
        assert_eq!(
            starting_point(&defaults, None, None),
            Start {
                options: options(),
                edits: Vec::new(),
                basis: entries_basis(),
                built: false,
                set_aside: false,
            }
        );
        assert_eq!(
            starting_point(&defaults, Some(draft(2.0)), Some(work(1.0)))
                .options
                .session_minutes,
            90
        );
        assert_eq!(
            starting_point(&defaults, Some(draft(1.0)), Some(work(2.0)))
                .options
                .session_minutes,
            100
        );
        assert!(starting_point(&defaults, None, Some(work(1.0))).built);
    }

    #[test]
    fn a_published_meet_opens_on_its_schedule_unless_the_work_was_made_on_it() {
        let mut published_options = options();
        published_options.platforms = vec!["Red".to_owned(), "Blue".to_owned()];
        let defaults = meet_defaults(Some(PublishedSchedule {
            version: Some("p2".to_owned()),
            options: published_options.clone(),
        }));
        let edit = BuilderEdit::SwapSessions {
            session: 1,
            with_session: 2,
        };
        let work = |basis: Basis| LocalWork {
            options: options(),
            edits: vec![edit.clone()],
            basis,
            saved_at: 1.0,
        };
        let fresh = starting_point(&defaults, None, None);
        assert_eq!(fresh.options, published_options);
        assert_eq!(fresh.basis, published_on("p2"));
        assert!(fresh.built && !fresh.set_aside && fresh.edits.is_empty());
        let resumed = starting_point(&defaults, None, Some(work(published_on("p2"))));
        assert_eq!(resumed.edits, vec![edit.clone()]);
        assert!(!resumed.set_aside);
        for stale in [published_on("p1"), entries_basis()] {
            let start = starting_point(&defaults, None, Some(work(stale)));
            assert_eq!(start.basis, published_on("p2"));
            assert!(start.edits.is_empty() && start.set_aside);
        }
        let saved: SavedDraft = serde_json::from_value(serde_json::json!({
            "options": serde_json::to_value(options()).unwrap(),
            "edits": [],
            "basis": { "base": "published", "baseVersion": "p2" },
            "updatedAt": 1
        }))
        .unwrap();
        assert_eq!(saved.basis, published_on("p2"));
        let older: LocalWork = serde_json::from_value(serde_json::json!({
            "options": serde_json::to_value(options()).unwrap(),
            "edits": [],
            "savedAt": 1
        }))
        .unwrap();
        assert_eq!(older.basis, entries_basis());
    }

    #[test]
    fn the_sport80_lists_say_what_publishing_leaves_out() {
        assert_eq!(added_note(0), "No new lifters.");
        assert_eq!(
            added_note(1),
            "1 new lifter isn’t placed, so they stay off the start list when you publish."
        );
        assert_eq!(
            added_note(3),
            "3 new lifters aren’t placed, so they stay off the start list when you publish."
        );
        assert_eq!(withdrawn_note(0), "Every published lifter is still on Sport80.");
        assert_eq!(withdrawn_note(2), "");
        assert_eq!(
            rebuild_warning(false, 1),
            "Building again discards your edit."
        );
        assert_eq!(
            rebuild_warning(false, 4),
            "Building again discards your 4 edits."
        );
        assert_eq!(
            rebuild_warning(true, 0),
            "Rebuilding from scratch regroups every entrant and replaces the published sessions when you publish."
        );
        assert_eq!(
            rebuild_warning(true, 2),
            "Rebuilding from scratch regroups every entrant, replaces the published sessions when you publish, and discards your 2 edits."
        );
    }

    #[test]
    fn a_published_base_answer_parses_with_its_sport80_changes() {
        let preview: BuiltSchedule = serde_json::from_value(serde_json::json!({
            "athletes": 1,
            "sessions": [{
                "id": 3, "number": 1, "date": "2026-11-14", "startTime": "09:00:00", "weighInTime": "07:00:00",
                "groups": [{
                    "platform": "Red", "gender": "Female", "ageGroup": "open", "split": "", "label": "W 48",
                    "weightClasses": ["48"],
                    "athletes": [{ "key": "1|ann", "memberId": "1", "name": "Ann", "age": 25, "club": "Club", "gender": "Female", "weightClass": "48", "entryTotal": 100, "withdrawn": true }]
                }]
            }],
            "warnings": [],
            "changes": {
                "checkedAt": 1700000000000_u64,
                "added": [{
                    "athlete": { "key": "2|bea", "memberId": "2", "name": "Bea", "age": 22, "club": "", "gender": "Female", "weightClass": "48", "entryTotal": 90 },
                    "suggestion": { "session": 3, "number": 1, "platform": "Red" }
                }],
                "withdrawn": [{
                    "athlete": { "key": "1|ann", "memberId": "1", "name": "Ann", "age": 25, "club": "Club", "gender": "Female", "weightClass": "48", "entryTotal": 100, "withdrawn": true },
                    "place": { "session": 3, "number": 1, "platform": "Red" },
                    "occurrence": 0
                }]
            }
        }))
        .unwrap();
        let athlete = &preview.sessions[0].groups[0].athletes[0];
        assert!(athlete.withdrawn);
        let changes = preview.changes.unwrap();
        assert_eq!(
            changes.added[0]
                .suggestion
                .as_ref()
                .map(BoardPlace::label)
                .as_deref(),
            Some("Session 1 · Red")
        );
        assert_eq!(changes.withdrawn[0].place.session, 3);
        assert_eq!(changes.withdrawn[0].athlete.name, "Ann");
    }

    fn session(id: u32, number: u32) -> BuiltSession {
        BuiltSession {
            id,
            number,
            date: "2026-11-14".to_owned(),
            start_time: "09:00:00".to_owned(),
            weigh_in_time: "07:00:00".to_owned(),
            groups: Vec::new(),
        }
    }

    #[test]
    fn an_athlete_can_move_to_every_other_session_and_platform() {
        let sessions = [session(4, 1), session(2, 2)];
        let platforms = ["Red".to_owned(), "Blue".to_owned()];
        assert_eq!(place_targets(&sessions, &platforms).len(), 4);
        let labels = move_targets(&sessions, &platforms, 4, "Red")
            .into_iter()
            .map(|target| (target.session, target.platform, target.label))
            .collect::<Vec<_>>();
        assert_eq!(
            labels,
            vec![
                (4, "Blue".to_owned(), "Session 1 · Blue".to_owned()),
                (2, "Red".to_owned(), "Session 2 · Red".to_owned()),
                (2, "Blue".to_owned(), "Session 2 · Blue".to_owned()),
            ]
        );
    }

    #[test]
    fn an_unscheduled_session_says_so() {
        let mut unscheduled = session(1, 1);
        unscheduled.start_time = String::new();
        unscheduled.date = String::new();
        assert_eq!(session_when(&unscheduled), "No Time");
        assert_eq!(session_when(&session(1, 1)), "November 14, 2026 · 9:00 AM");
    }

    #[test]
    fn the_servers_answers_parse() {
        let preview: BuiltSchedule = serde_json::from_value(serde_json::json!({
            "athletes": 1,
            "sessions": [{
                "id": 3, "number": 1, "date": "2026-11-14", "startTime": "09:00:00", "weighInTime": "07:00:00",
                "groups": [{
                    "platform": "Red", "gender": "Female", "ageGroup": "youth", "split": "", "label": "W 48 (Youth)",
                    "weightClasses": ["48"],
                    "athletes": [{ "key": "1|ann", "memberId": "1", "name": "Ann", "age": 15, "club": "Club", "gender": "Female", "weightClass": "48", "entryTotal": 100 }]
                }]
            }],
            "warnings": [{ "code": "unscheduled", "message": "1 session did not fit." }]
        }))
        .unwrap();
        assert_eq!(preview.sessions.len(), 1);
        let publications: Publications = serde_json::from_value(serde_json::json!({
            "organizer": false,
            "publications": [{ "id": "p1", "status": "pending", "createdAt": 1, "decidedAt": null }]
        }))
        .unwrap();
        assert_eq!(
            publications
                .publications
                .first()
                .map(|publication| publication_status_label(&publication.status)),
            Some("In Review")
        );
    }
}
