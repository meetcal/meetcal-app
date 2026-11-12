use super::*;
use crate::utils::text::capitalize_first;
use anyhow::{Result, anyhow};
use serde::Serialize;
use serde_json::{Map, Value};
use std::time::Duration;

pub(super) const MEET_SUBMISSION_UPLOAD_URL: &str = "meetSubmissions:generateUploadUrl";
pub(super) const MEET_SUBMISSION_SUBMIT: &str = "meetSubmissions:submit";

pub(crate) const UPLOAD_SILENCE_LIMIT: Duration = Duration::from_secs(120);

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetSubmissionFile {
    pub storage_id: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetSubmission {
    pub meet_name: String,
    pub start_date: String,
    pub end_date: Option<String>,
    pub contact_email: Option<String>,
    pub files: Vec<MeetSubmissionFile>,
}

pub(super) async fn post_meet_submission(function: &str, args: &Value) -> Result<QueryResponse> {
    let token = crate::auth::session_token()
        .await
        .ok_or_else(|| anyhow!(SESSION_MESSAGE))?;
    post(Endpoint::Mutation, function, args, Some(&token)).await
}

pub(crate) async fn meet_submission_upload_url() -> Result<String> {
    let response =
        post_meet_submission(MEET_SUBMISSION_UPLOAD_URL, &Value::Object(Map::new())).await?;
    read_upload_url(response)
}

pub(crate) async fn upload_meet_submission_file(
    upload_url: &str,
    content_type: &str,
    bytes: Vec<u8>,
) -> Result<String> {
    let reply = crate::utils::http::upload(crate::utils::http::Upload {
        url: upload_url,
        body: &bytes,
        content_type,
        silence_limit: UPLOAD_SILENCE_LIMIT,
    })
    .await
    .map_err(|failure| transport_error("file upload", &failure))?;
    if !(200..300).contains(&reply.status) {
        return Err(user_error(
            "file upload",
            &format!("MeetCal couldn't store the file (HTTP {})", reply.status),
            reply.status,
        ));
    }
    read_storage_id(reply.body.as_bytes())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum MeetSubmissionOutcome {
    Submitted,
    FilesAlreadySubmitted { server_said: String },
}

pub(super) const FILE_ALREADY_SUBMITTED_CODE: &str = "already_submitted";

pub(crate) async fn submit_meet(submission: &MeetSubmission) -> Result<MeetSubmissionOutcome> {
    let args = serde_json::to_value(submission)
        .map_err(|error| user_error(MEET_SUBMISSION_SUBMIT, UNREACHABLE_MESSAGE, error))?;
    let response = post_meet_submission(MEET_SUBMISSION_SUBMIT, &args).await?;
    read_submitted(response)
}

pub(super) fn meet_submission_value(response: QueryResponse) -> Result<Value> {
    let status = function_error_status(&response);
    if status == Some(401) {
        return Err(anyhow!(SESSION_MESSAGE));
    }
    if let (
        Some(status @ (400 | 413 | 429)),
        QueryResponse::Error {
            error_data: Some(data),
            ..
        },
    ) = (status, &response)
        && let Some(error) = data.get("error").and_then(Value::as_str)
    {
        let sentence = capitalize_first(error);
        return Err(anyhow!(if status == 429 {
            format!("{sentence}. Please try again tomorrow.")
        } else {
            sentence
        }));
    }
    answer_json(response)
}

pub(super) fn read_upload_url(response: QueryResponse) -> Result<String> {
    let value = meet_submission_value(response)?;
    value
        .get("uploadUrl")
        .and_then(Value::as_str)
        .filter(|url| url.starts_with("https://"))
        .map(str::to_owned)
        .ok_or_else(|| user_error(MEET_SUBMISSION_UPLOAD_URL, UNREADABLE_MESSAGE, value))
}

pub(super) fn read_storage_id(body: &[u8]) -> Result<String> {
    serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|value| value.get("storageId")?.as_str().map(str::to_owned))
        .filter(|id| !id.is_empty())
        .ok_or_else(|| {
            user_error(
                "file upload",
                UNREADABLE_MESSAGE,
                String::from_utf8_lossy(body),
            )
        })
}

pub(super) fn files_already_submitted(response: &QueryResponse) -> Option<String> {
    let QueryResponse::Error {
        error_data: Some(data),
        ..
    } = response
    else {
        return None;
    };
    (data.get("code").and_then(Value::as_str) == Some(FILE_ALREADY_SUBMITTED_CODE)).then(|| {
        capitalize_first(
            data.get("error")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        )
    })
}

pub(super) fn read_submitted(response: QueryResponse) -> Result<MeetSubmissionOutcome> {
    if let Some(server_said) = files_already_submitted(&response) {
        return Ok(MeetSubmissionOutcome::FilesAlreadySubmitted { server_said });
    }
    let value = meet_submission_value(response)?;
    if value.get("submitted").and_then(Value::as_bool) == Some(true) {
        Ok(MeetSubmissionOutcome::Submitted)
    } else {
        Err(user_error(
            MEET_SUBMISSION_SUBMIT,
            UNREADABLE_MESSAGE,
            value,
        ))
    }
}
