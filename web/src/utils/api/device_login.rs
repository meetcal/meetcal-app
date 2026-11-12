use super::*;
use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub(super) const DEVICE_LOGIN_DESCRIBE: &str = "deviceLogin:describe";
pub(super) const DEVICE_LOGIN_APPROVE: &str = "deviceLogin:approve";
pub(super) const DEVICE_LOGIN_DENY: &str = "deviceLogin:deny";

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingDeviceLogin {
    pub device_name: String,
    pub created_at: f64,
    pub expires_at: f64,
}

pub(super) const REVOKE_ALL_CLI: &str = "apiTokens:revokeAllCli";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DeviceLoginOutcome {
    Done,
    Gone,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DeviceLoginArgs<'a> {
    pub(super) user_code: &'a str,
}

pub(super) async fn post_device_login(
    endpoint: Endpoint,
    function: &str,
    user_code: &str,
) -> Result<QueryResponse> {
    let token = crate::auth::session_token()
        .await
        .ok_or_else(|| anyhow!(SESSION_MESSAGE))?;
    let args = serde_json::to_value(DeviceLoginArgs { user_code })
        .map_err(|error| user_error(function, UNREACHABLE_MESSAGE, error))?;
    post(endpoint, function, &args, Some(&token)).await
}

pub(crate) async fn describe_device_login(user_code: &str) -> Result<Option<PendingDeviceLogin>> {
    let response = post_device_login(Endpoint::Query, DEVICE_LOGIN_DESCRIBE, user_code).await?;
    read_pending_device_login(response)
}

pub(crate) async fn approve_device_login(user_code: &str) -> Result<DeviceLoginOutcome> {
    let response = post_device_login(Endpoint::Mutation, DEVICE_LOGIN_APPROVE, user_code).await?;
    read_device_login_outcome(DEVICE_LOGIN_APPROVE, response)
}

pub(crate) async fn deny_device_login(user_code: &str) -> Result<DeviceLoginOutcome> {
    let response = post_device_login(Endpoint::Mutation, DEVICE_LOGIN_DENY, user_code).await?;
    read_device_login_outcome(DEVICE_LOGIN_DENY, response)
}

pub(crate) async fn revoke_all_cli_logins() -> Result<u64> {
    let token = crate::auth::session_token()
        .await
        .ok_or_else(|| anyhow!(SESSION_MESSAGE))?;
    let response = post(
        Endpoint::Mutation,
        REVOKE_ALL_CLI,
        &Value::Object(Map::new()),
        Some(&token),
    )
    .await?;
    read_revoked_count(response)
}

pub(super) fn read_revoked_count(response: QueryResponse) -> Result<u64> {
    let value = device_login_value(response)?;
    value
        .get("ended")
        .and_then(Value::as_f64)
        .filter(|ended| ended.fract() == 0.0 && (0.0..=f64::from(u32::MAX)).contains(ended))
        .map(|ended| ended as u64)
        .ok_or_else(|| user_error(REVOKE_ALL_CLI, UNREADABLE_MESSAGE, value))
}

pub(super) fn device_login_value(response: QueryResponse) -> Result<Value> {
    if function_error_status(&response) == Some(401) {
        return Err(anyhow!(SESSION_MESSAGE));
    }
    answer_value(response)
}

pub(super) fn read_pending_device_login(
    response: QueryResponse,
) -> Result<Option<PendingDeviceLogin>> {
    let value = device_login_value(response)?;
    serde_json::from_value(value)
        .map_err(|error| user_error(DEVICE_LOGIN_DESCRIBE, UNREADABLE_MESSAGE, error))
}

pub(super) fn read_device_login_outcome(
    function: &str,
    response: QueryResponse,
) -> Result<DeviceLoginOutcome> {
    if function_error_status(&response) == Some(404) {
        return Ok(DeviceLoginOutcome::Gone);
    }
    let value = device_login_value(response)?;
    if value.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(DeviceLoginOutcome::Done)
    } else {
        Err(user_error(function, UNREADABLE_MESSAGE, value))
    }
}
