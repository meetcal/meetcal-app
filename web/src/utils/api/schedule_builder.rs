use super::*;
use crate::utils::text::capitalize_first;
use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Map, Value, json};
use std::time::Duration;

pub(super) const BUILDER_LOAD: &str = "scheduleBuilderLoad:load";
pub(super) const BUILDER_SEARCH: &str = "scheduleBuilderLoad:search";
pub(super) const BUILDER_DEFAULTS: &str = "scheduleBuilder:defaults";
pub(super) const BUILDER_PREVIEW: &str = "scheduleBuilder:preview";
pub(super) const BUILDER_EXPORT: &str = "scheduleBuilder:exportFile";
pub(super) const BUILDER_DRAFTS: &str = "scheduleBuilder:drafts";
pub(super) const BUILDER_DRAFT: &str = "scheduleBuilder:draft";
pub(super) const BUILDER_SAVE_DRAFT: &str = "scheduleBuilder:saveDraft";
pub(super) const BUILDER_DELETE_DRAFT: &str = "scheduleBuilder:deleteDraft";
pub(super) const SCHEDULE_PUBLISH: &str = "schedulePublications:publish";
pub(super) const SCHEDULE_PUBLICATIONS: &str = "schedulePublications:publications";

pub(crate) const SPORT80_LOAD_TIMEOUT: Duration = Duration::from_secs(120);
pub(crate) const SPORT80_SEARCH_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BuilderDay {
    pub date: String,
    pub first_start: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Grouping {
    WeightClass,
    EntryTotal,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SessionOrder {
    WomenThenMen,
    Alternate,
    WomenDayMenDay,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BuilderOptions {
    pub days: Vec<BuilderDay>,
    pub session_minutes: u32,
    pub break_minutes: u32,
    pub max_athletes_per_platform: u32,
    pub max_sessions_per_day: Option<u32>,
    pub platforms: Vec<String>,
    pub grouping: Grouping,
    pub separate_age_groups: bool,
    pub order: SessionOrder,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum BuilderEdit {
    MoveAthlete {
        athlete: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from_session: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from_platform: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        occurrence: Option<u32>,
        to_session: u32,
        to_platform: String,
    },
    MoveClass {
        from_session: u32,
        from_platform: String,
        weight_class: String,
        to_session: u32,
        to_platform: String,
    },
    SwapSessions {
        session: u32,
        with_session: u32,
    },
    SetSessionTime {
        session: u32,
        date: String,
        start_time: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ExportFormat {
    Csv,
    Xlsx,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ExportEncoding {
    Utf8,
    Base64,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportFile {
    pub file_name: String,
    pub content_type: String,
    pub encoding: ExportEncoding,
    pub content: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub(crate) struct LoadedMeet {
    pub meet: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetMatch {
    pub event_id: String,
    pub name: String,
    pub start_date: String,
    pub end_date: String,
    pub place: String,
    pub entries_url: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub(crate) struct MeetMatches {
    pub results: Vec<MeetMatch>,
    pub truncated: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum PublishStatus {
    Live,
    Pending,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub(crate) struct PublishOutcome {
    pub status: PublishStatus,
    pub sessions: u32,
    pub athletes: u32,
}

#[derive(Serialize)]
struct MeetArgs<'a> {
    meet: &'a str,
}

#[derive(Serialize)]
struct ScheduleArgs<'a> {
    meet: &'a str,
    options: &'a BuilderOptions,
    edits: &'a [BuilderEdit],
}

pub(super) fn builder_value(response: QueryResponse) -> Result<Value> {
    if function_error_status(&response) == Some(401) {
        return Err(anyhow!(SESSION_MESSAGE));
    }
    if let QueryResponse::Error {
        error_data: Some(data),
        ..
    } = &response
        && let Some(error) = data.get("error").and_then(Value::as_str)
    {
        return Err(anyhow!(capitalize_first(error)));
    }
    answer_value(response)
}

pub(super) fn read_builder_answer<T: DeserializeOwned>(
    function: &str,
    response: QueryResponse,
) -> Result<T> {
    let value = builder_value(response)?;
    serde_json::from_value(whole_numbers_as_integers(value))
        .map_err(|error| user_error(function, UNREADABLE_MESSAGE, error))
}

fn args_of(function: &str, args: impl Serialize) -> Result<Value> {
    serde_json::to_value(args).map_err(|error| user_error(function, UNREACHABLE_MESSAGE, error))
}

async fn public_call<T: DeserializeOwned>(
    endpoint: Endpoint,
    function: &str,
    args: impl Serialize,
    timeout: Duration,
) -> Result<T> {
    let args = args_of(function, args)?;
    let response = post_within(endpoint, function, &args, None, timeout).await?;
    read_builder_answer(function, response)
}

async fn signed_in_call<T: DeserializeOwned>(
    endpoint: Endpoint,
    function: &str,
    args: impl Serialize,
) -> Result<T> {
    let token = crate::auth::session_token()
        .await
        .ok_or_else(|| anyhow!(SESSION_MESSAGE))?;
    let args = args_of(function, args)?;
    let response = post(endpoint, function, &args, Some(&token)).await?;
    read_builder_answer(function, response)
}

pub(crate) async fn load_builder_meet(url: &str) -> Result<LoadedMeet> {
    public_call(
        Endpoint::Action,
        BUILDER_LOAD,
        json!({ "url": url }),
        SPORT80_LOAD_TIMEOUT,
    )
    .await
}

pub(crate) async fn search_builder_meets(query: &str) -> Result<MeetMatches> {
    public_call(
        Endpoint::Action,
        BUILDER_SEARCH,
        json!({ "query": query }),
        SPORT80_SEARCH_TIMEOUT,
    )
    .await
}

pub(crate) async fn builder_defaults<T: DeserializeOwned>(meet: &str) -> Result<T> {
    public_call(
        Endpoint::Query,
        BUILDER_DEFAULTS,
        MeetArgs { meet },
        REQUEST_TIMEOUT,
    )
    .await
}

pub(crate) async fn builder_preview<T: DeserializeOwned>(
    meet: &str,
    options: &BuilderOptions,
    edits: &[BuilderEdit],
) -> Result<T> {
    public_call(
        Endpoint::Query,
        BUILDER_PREVIEW,
        ScheduleArgs {
            meet,
            options,
            edits,
        },
        REQUEST_TIMEOUT,
    )
    .await
}

#[derive(Serialize)]
struct ExportArgs<'a> {
    meet: &'a str,
    options: &'a BuilderOptions,
    edits: &'a [BuilderEdit],
    format: ExportFormat,
}

pub(crate) async fn builder_export(
    meet: &str,
    options: &BuilderOptions,
    edits: &[BuilderEdit],
    format: ExportFormat,
) -> Result<ExportFile> {
    public_call(
        Endpoint::Query,
        BUILDER_EXPORT,
        ExportArgs {
            meet,
            options,
            edits,
            format,
        },
        REQUEST_TIMEOUT,
    )
    .await
}

pub(crate) async fn builder_drafts<T: DeserializeOwned>() -> Result<T> {
    signed_in_call(Endpoint::Query, BUILDER_DRAFTS, Map::new()).await
}

pub(crate) async fn builder_draft<T: DeserializeOwned>(meet: &str) -> Result<T> {
    signed_in_call(Endpoint::Query, BUILDER_DRAFT, MeetArgs { meet }).await
}

pub(crate) async fn save_builder_draft(
    meet: &str,
    options: &BuilderOptions,
    edits: &[BuilderEdit],
) -> Result<()> {
    signed_in_call::<Value>(
        Endpoint::Mutation,
        BUILDER_SAVE_DRAFT,
        ScheduleArgs {
            meet,
            options,
            edits,
        },
    )
    .await
    .map(drop)
}

pub(crate) async fn delete_builder_draft(meet: &str) -> Result<()> {
    signed_in_call::<Value>(Endpoint::Mutation, BUILDER_DELETE_DRAFT, MeetArgs { meet })
        .await
        .map(drop)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublishArgs<'a> {
    meet: &'a str,
    options: &'a BuilderOptions,
    edits: &'a [BuilderEdit],
    contact_email: Option<&'a str>,
}

pub(crate) async fn publish_schedule(
    meet: &str,
    options: &BuilderOptions,
    edits: &[BuilderEdit],
    contact_email: Option<&str>,
) -> Result<PublishOutcome> {
    signed_in_call(
        Endpoint::Mutation,
        SCHEDULE_PUBLISH,
        PublishArgs {
            meet,
            options,
            edits,
            contact_email,
        },
    )
    .await
}

pub(crate) async fn schedule_publications<T: DeserializeOwned>(meet: &str) -> Result<T> {
    signed_in_call(Endpoint::Query, SCHEDULE_PUBLICATIONS, MeetArgs { meet }).await
}

const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_digit(symbol: u8) -> Option<u32> {
    BASE64_ALPHABET
        .iter()
        .position(|candidate| *candidate == symbol)
        .and_then(|digit| u32::try_from(digit).ok())
}

pub(crate) fn decode_base64(text: &str) -> Option<Vec<u8>> {
    let symbols = text
        .bytes()
        .filter(|symbol| !symbol.is_ascii_whitespace())
        .collect::<Vec<_>>();
    if symbols.len() % 4 != 0 {
        return None;
    }
    let mut bytes = Vec::with_capacity(symbols.len() / 4 * 3);
    let quads = symbols.chunks(4).count();
    for (index, quad) in symbols.chunks(4).enumerate() {
        let padding = quad
            .iter()
            .rev()
            .take_while(|symbol| **symbol == b'=')
            .count();
        if padding > 2 || (padding > 0 && index + 1 != quads) {
            return None;
        }
        let mut value = 0_u32;
        for (position, symbol) in quad.iter().enumerate() {
            let digit = if position + padding >= 4 {
                0
            } else {
                base64_digit(*symbol)?
            };
            value = (value << 6) | digit;
        }
        let [_, first, second, third] = value.to_be_bytes();
        bytes.extend([first, second, third].into_iter().take(3 - padding));
    }
    Some(bytes)
}

impl ExportFile {
    pub(crate) fn bytes(&self) -> Result<Vec<u8>> {
        match self.encoding {
            ExportEncoding::Utf8 => Ok(self.content.as_bytes().to_vec()),
            ExportEncoding::Base64 => decode_base64(&self.content)
                .ok_or_else(|| user_error(BUILDER_EXPORT, UNREADABLE_MESSAGE, "bad base64")),
        }
    }
}
