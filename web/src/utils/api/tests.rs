use super::*;
use crate::utils::http::{OK, SERVICE_UNAVAILABLE, TOO_MANY_REQUESTS};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use serde_json::json;
use std::time::Duration;

fn answer(value: Value) -> QueryResponse {
    serde_json::from_str(&value.to_string()).unwrap()
}

#[test]
fn the_name_lists_read_the_servers_answers() {
    for (query, fixture) in [
        (queries::WSO_LIST, wire_fixture!("reference.wsoList")),
        (
            queries::REGISTRATION_WSOS,
            wire_fixture!("reference.registrationWsos"),
        ),
        (queries::CLUBS, wire_fixture!("reference.clubs")),
    ] {
        for names in wire::read::<Vec<String>>(query, fixture) {
            assert!(!names.is_empty(), "{}", query.function);
        }
    }
}

#[test]
fn the_pass_and_the_entitlement_read_the_servers_answers() {
    for response in wire::responses(ACCESS_PASS, wire_fixture!("accessPass.pass")) {
        assert!(matches!(
            read_pass_answer(response).unwrap(),
            PassAnswer::Granted(pass) if pass.pass == "fixture-pass"
        ));
    }
    for response in wire::responses(REFRESH_ENTITLEMENT, wire_fixture!("entitlements.refresh")) {
        assert!(read_entitlement(response).unwrap());
    }
}

#[test]
fn a_meet_submission_reads_the_servers_answers() {
    for response in wire::responses(
        MEET_SUBMISSION_UPLOAD_URL,
        wire_fixture!("meetSubmissions.generateUploadUrl"),
    ) {
        assert!(read_upload_url(response).unwrap().starts_with("https://"));
    }
    for response in wire::responses(
        MEET_SUBMISSION_SUBMIT,
        wire_fixture!("meetSubmissions.submit"),
    ) {
        assert_eq!(
            read_submitted(response).unwrap(),
            MeetSubmissionOutcome::Submitted
        );
    }
}

#[test]
fn production_builds_read_the_production_deployment() {
    if option_env!("MEETCAL_CONVEX_URL").is_none() {
        assert_eq!(convex_url(), PRODUCTION_CONVEX_URL);
    }
}

#[test]
fn the_premium_actions_carry_the_pass_and_wait_longer_than_a_query() {
    assert!(SUBSCRIPTION_ACTIONS.contains(&actions::WSO_ELITE.function));
    assert!(!SUBSCRIPTION_FUNCTIONS.contains(&actions::WSO_ELITE.function));
    assert!(actions::WSO_ELITE.timeout > REQUEST_TIMEOUT);
}

#[test]
fn requests_name_the_function_and_its_arguments_as_json() {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Args {
        age_category: &'static str,
    }
    let body = serde_json::to_value(QueryRequest {
        path: queries::NATIONAL_RANKINGS.function,
        args: &Args {
            age_category: "Open Men's 60kg",
        },
        format: "json",
    })
    .unwrap();
    assert_eq!(
        body,
        json!({"path": "reference:nationalRankings", "args": {"ageCategory": "Open Men's 60kg"}, "format": "json"})
    );
    assert_eq!(serde_json::to_value(NoArgs {}).unwrap(), json!({}));
}

#[test]
fn premium_queries_carry_the_pass_and_the_rest_do_not() {
    let args = json!({"meet": "Test Meet"});
    for query in [
        queries::MEET_RESULTS,
        queries::RECORDS,
        queries::STANDARDS,
        queries::QUALIFYING_TOTALS,
        queries::INTL_RANKINGS,
        queries::NATIONAL_RANKINGS,
        queries::NATIONAL_RANKINGS_BY_YEAR,
        queries::WSO_LIST,
        queries::WSO_RECORDS,
        queries::RECORD_CATEGORIES,
        queries::QUALIFYING_TOTAL_CATEGORIES,
        queries::ADAPTIVE_RECORDS,
        queries::CLUBS,
        queries::CLUB_MEETS,
        queries::CLUB_MEET_STATS,
        queries::ATHLETE,
    ] {
        assert!(query.is_premium(), "{}", query.function);
        assert!(carries_pass(query, &args), "{}", query.function);
    }
    for query in [
        queries::UPCOMING_MEETS,
        queries::COMPLETED_MEETS,
        queries::MEET_SCHEDULE,
        queries::MEET_ATHLETES,
        queries::WRAPPED,
    ] {
        assert!(!query.is_premium(), "{}", query.function);
        assert!(!carries_pass(query, &args), "{}", query.function);
    }
    assert_eq!(SUBSCRIPTION_FUNCTIONS.len(), 29);
    assert!(!SUBSCRIPTION_FUNCTIONS.contains(&ACCESS_PASS));
    assert!(!SUBSCRIPTION_FUNCTIONS.contains(&REFRESH_ENTITLEMENT));
}

#[test]
fn only_a_dated_search_carries_the_pass() {
    assert!(queries::SEARCH.is_premium());
    let dated = json!({"query": "Smith", "startDate": "2026-01-01", "endDate": "2026-12-31"});
    assert!(carries_pass(queries::SEARCH, &dated));
    for suggestion in [
        json!({"query": "Smi"}),
        json!({"query": "Smi", "startDate": "2026-01-01"}),
        json!({"query": "Smi", "endDate": "2026-12-31"}),
        json!({"query": "Smi", "startDate": null, "endDate": null}),
    ] {
        assert!(!carries_pass(queries::SEARCH, &suggestion), "{suggestion}");
    }
}

#[test]
fn the_pass_goes_into_the_arguments() {
    let args = json!({"club": "Test Barbell", "cursor": null});
    assert_eq!(
        with_pass(&args, Some("p1")),
        json!({"club": "Test Barbell", "cursor": null, "pass": "p1"})
    );
    assert_eq!(with_pass(&args, None), args);
    assert_eq!(with_pass(&json!({}), Some("p1")), json!({"pass": "p1"}));
}

#[test]
fn only_a_401_or_403_function_error_refuses_the_pass() {
    let error = |data: Value| {
        answer(json!({"status": "error", "errorMessage": "Server Error", "errorData": data}))
    };
    for status in [json!(401), json!(403), json!(403.0)] {
        assert!(
            is_pass_refused(&error(
                json!({"status": status, "error": "access pass expired"})
            )),
            "{status}"
        );
    }
    for data in [
        json!({"status": 400, "error": "year must be a four-digit year"}),
        json!({"status": 503}),
        json!({"error": "no status"}),
        json!(null),
    ] {
        assert!(!is_pass_refused(&error(data.clone())), "{data}");
    }
    assert!(!is_pass_refused(&answer(
        json!({"status": "error", "errorMessage": "Server Error"})
    )));
    assert!(!is_pass_refused(&answer(
        json!({"status": "success", "value": {"status": 403}})
    )));
}

#[test]
fn pass_answers_grant_the_pass_or_ask_for_a_refresh() {
    assert_eq!(
        read_pass_answer(answer(
            json!({"status": "success", "value": {"pass": "p1", "rotatesAt": 1_800_000_000_000.0}})
        ))
        .unwrap(),
        PassAnswer::Granted(AccessPass {
            pass: "p1".to_owned(),
            rotates_at: 1_800_000_000_000.0
        })
    );
    assert_eq!(
        read_pass_answer(answer(json!({
            "status": "error",
            "errorMessage": "Server Error",
            "errorData": {"status": 403, "error": "subscription required"}
        })))
        .unwrap(),
        PassAnswer::SubscriptionRequired
    );
    assert_eq!(
        read_pass_answer(answer(json!({
            "status": "error",
            "errorMessage": "Server Error",
            "errorData": {"status": 401, "error": "unauthorized"}
        })))
        .unwrap(),
        PassAnswer::SignedOut
    );
    for response in [
        json!({"status": "error", "errorMessage": "Server Error", "errorData": {"status": 503, "error": "no access pass yet"}}),
        json!({"status": "success", "value": {"pass": "", "rotatesAt": 1.0}}),
        json!({"status": "success", "value": {"pass": "p1"}}),
        json!({"status": "success", "value": {"rotatesAt": 1.0}}),
    ] {
        assert!(
            read_pass_answer(answer(response.clone())).is_err(),
            "{response}"
        );
    }
}

#[test]
fn the_pass_answer_decides_who_sees_data_pages() {
    let pass = AccessPass {
        pass: "p1".to_owned(),
        rotates_at: 1.0,
    };
    assert_eq!(refusal_of(Ok(PassAnswer::Granted(pass.clone()))), Ok(pass));
    assert_eq!(
        refusal_of(Ok(PassAnswer::SubscriptionRequired)),
        Err(PassRefusal::SubscriptionRequired)
    );
    assert_eq!(
        refusal_of(Ok(PassAnswer::SignedOut)),
        Err(PassRefusal::SignedOut)
    );
    assert_eq!(
        refusal_of(Err(anyhow::anyhow!(
            "MeetCal could not answer: no access pass yet"
        ))),
        Err(PassRefusal::Unavailable(
            ACCESS_UNAVAILABLE_MESSAGE.to_owned()
        ))
    );
}

#[test]
fn a_read_convex_refused_waits_for_a_pass_fetch_older_than_the_first_reads_wait() {
    let now = 1_000_000_000.0;
    let slow_fetch_started_at = now - 2.0 * PASS_WAIT_MS;
    assert_eq!(
        pass_wait_left(PassWaiter::FirstRead, slow_fetch_started_at, now),
        0.0
    );
    assert_eq!(
        pass_wait_left(PassWaiter::ReadConvexRefused, slow_fetch_started_at, now),
        REFUSED_READ_PASS_WAIT_MS
    );
    assert_eq!(
        pass_wait_left(PassWaiter::ReadConvexRefused, now, now),
        REFUSED_READ_PASS_WAIT_MS
    );
}

#[test]
fn a_pass_is_held_until_it_rotates() {
    let now = 1_000_000_000.0;
    let day = 24.0 * 60.0 * 60.0 * 1000.0;
    assert_eq!(held_until(now + day, now), now + day);
    assert_eq!(held_until(now - day, now), now + MIN_PASS_HOLD_MS);
    assert_eq!(
        pass_wait_left(PassWaiter::FirstRead, now, now),
        PASS_WAIT_MS
    );
    assert_eq!(
        pass_wait_left(PassWaiter::FirstRead, now - PASS_WAIT_MS / 2.0, now),
        PASS_WAIT_MS / 2.0
    );
    assert_eq!(
        pass_wait_left(PassWaiter::FirstRead, now - 2.0 * PASS_WAIT_MS, now),
        0.0
    );
    assert_eq!(held_until(now + 1.0, now), now + MIN_PASS_HOLD_MS);

    let held = HeldPass {
        pass: "p1".to_owned(),
        until: now + day,
    };
    assert_eq!(usable_pass(Some(&held), now), Some("p1"));
    assert_eq!(usable_pass(Some(&held), now + day - 1.0), Some("p1"));
    assert_eq!(usable_pass(Some(&held), now + day), None);
    assert_eq!(usable_pass(None, now), None);
}

#[test]
fn a_failed_pass_fetch_is_not_repeated_for_a_while() {
    let now = 1_000_000_000.0;
    assert!(may_fetch(None, now));
    assert!(!may_fetch(Some(now), now));
    assert!(!may_fetch(Some(now - PASS_FETCH_BACKOFF_MS + 1.0), now));
    assert!(may_fetch(Some(now - PASS_FETCH_BACKOFF_MS), now));
}

#[test]
fn entitlement_refreshes_answer_whether_the_entitlement_is_active() {
    for active in [true, false] {
        let response = answer(json!({"status": "success", "value": {"active": active}}));
        assert_eq!(read_entitlement(response).unwrap(), active);
    }
    assert!(read_entitlement(answer(json!({"status": "success", "value": {}}))).is_err());
    assert!(
        read_entitlement(answer(
            json!({"status": "error", "errorMessage": "Unauthenticated"})
        ))
        .is_err()
    );
}

#[test]
fn device_login_calls_send_the_user_code_in_camel_case() {
    assert_eq!(
        serde_json::to_value(DeviceLoginArgs {
            user_code: "WXYZ-BCDF"
        })
        .unwrap(),
        json!({"userCode": "WXYZ-BCDF"})
    );
}

#[test]
fn a_described_login_is_the_pending_one_or_none() {
    assert_eq!(
        read_pending_device_login(answer(json!({"status": "success", "value": {
            "deviceName": "maddisen-laptop",
            "createdAt": 1_800_000_000_000.0,
            "expiresAt": 1_800_000_600_000.0
        }})))
        .unwrap(),
        Some(PendingDeviceLogin {
            device_name: "maddisen-laptop".to_owned(),
            created_at: 1_800_000_000_000.0,
            expires_at: 1_800_000_600_000.0,
        })
    );
    assert_eq!(
        read_pending_device_login(answer(json!({"status": "success", "value": null}))).unwrap(),
        None
    );
}

#[test]
fn a_malformed_or_refused_description_is_an_error() {
    for value in [
        json!({"deviceName": "laptop"}),
        json!({"deviceName": 3, "createdAt": 1.0, "expiresAt": 2.0}),
        json!([]),
        json!("WXYZ-BCDF"),
    ] {
        let error = read_pending_device_login(answer(json!({"status": "success", "value": value})))
            .unwrap_err();
        assert_eq!(error.to_string(), UNREADABLE_MESSAGE, "{value}");
    }
    let error = read_pending_device_login(answer(json!({
        "status": "error",
        "errorMessage": "Server Error",
        "errorData": {"status": 401.0, "error": "unauthorized"}
    })))
    .unwrap_err();
    assert_eq!(error.to_string(), SESSION_MESSAGE);
}

#[test]
fn approving_or_denying_is_done_or_finds_the_code_gone() {
    let ok = || answer(json!({"status": "success", "value": {"ok": true}}));
    let missing = || {
        answer(json!({
            "status": "error",
            "errorMessage": "Server Error",
            "errorData": {"status": 404, "error": "no pending login has that code"}
        }))
    };
    for function in [DEVICE_LOGIN_APPROVE, DEVICE_LOGIN_DENY] {
        assert_eq!(
            read_device_login_outcome(function, ok()).unwrap(),
            DeviceLoginOutcome::Done
        );
        assert_eq!(
            read_device_login_outcome(function, missing()).unwrap(),
            DeviceLoginOutcome::Gone
        );
    }

    let signed_out = answer(json!({
        "status": "error",
        "errorMessage": "Server Error",
        "errorData": {"status": 401, "error": "unauthorized"}
    }));
    assert_eq!(
        read_device_login_outcome(DEVICE_LOGIN_APPROVE, signed_out)
            .unwrap_err()
            .to_string(),
        SESSION_MESSAGE
    );
    for value in [json!({"ok": false}), json!({}), json!(null)] {
        assert_eq!(
            read_device_login_outcome(
                DEVICE_LOGIN_APPROVE,
                answer(json!({"status": "success", "value": value}))
            )
            .unwrap_err()
            .to_string(),
            UNREADABLE_MESSAGE,
            "{value}"
        );
    }
    assert_eq!(
        read_device_login_outcome(
            DEVICE_LOGIN_APPROVE,
            answer(json!({"status": "error", "errorMessage": "Server Error"}))
        )
        .unwrap_err()
        .to_string(),
        "MeetCal could not answer: Server Error"
    );
}

#[test]
fn signing_out_cli_logins_answers_how_many_ended() {
    for (ended, count) in [(json!(0), 0), (json!(2.0), 2), (json!(3), 3)] {
        let response = answer(json!({"status": "success", "value": {"ended": ended}}));
        assert_eq!(read_revoked_count(response).unwrap(), count);
    }
    for value in [
        json!({}),
        json!({"ended": -1}),
        json!({"ended": 1.5}),
        json!({"ended": "2"}),
    ] {
        assert_eq!(
            read_revoked_count(answer(json!({"status": "success", "value": value})))
                .unwrap_err()
                .to_string(),
            UNREADABLE_MESSAGE,
            "{value}"
        );
    }
    let signed_out = answer(json!({
        "status": "error",
        "errorMessage": "Server Error",
        "errorData": {"status": 401, "error": "unauthorized"}
    }));
    assert_eq!(
        read_revoked_count(signed_out).unwrap_err().to_string(),
        SESSION_MESSAGE
    );
}

#[test]
fn only_mutations_are_not_retried_by_themselves() {
    assert!(Endpoint::Query.retries());
    assert!(Endpoint::Action.retries());
    assert!(!Endpoint::Mutation.retries());
}

#[test]
fn value_answers_are_the_body() {
    let rows: Vec<String> = read_response(
        Query::value("test:value"),
        answer(json!({"status": "success", "value": ["a", "b"], "logLines": []})),
    )
    .unwrap();
    assert_eq!(rows, ["a", "b"]);
}

#[test]
fn whole_numbers_in_value_answers_fit_integer_fields() {
    #[derive(Deserialize)]
    struct Stats {
        gold_medals: u64,
        total_weight_lifted: f64,
        snatch_make_rate: i64,
    }
    let stats: Stats = read_response(
        Query::value("reference:clubMeetStats"),
        answer(json!({"status": "success", "value": {
            "gold_medals": 3.0, "total_weight_lifted": 74.5, "snatch_make_rate": 67.0
        }})),
    )
    .unwrap();
    assert_eq!(stats.gold_medals, 3);
    assert_eq!(stats.total_weight_lifted, 74.5);
    assert_eq!(stats.snatch_make_rate, 67);
}

#[test]
fn text_answers_carry_the_body_as_json_text() {
    for value in [
        json!({"json": "[1,2]"}),
        json!({"etag": "\"x\"", "json": "[1,2]"}),
    ] {
        let rows: Vec<u32> = read_response(
            Query::tagged("test:text"),
            answer(json!({"status": "success", "value": value})),
        )
        .unwrap();
        assert_eq!(rows, [1, 2]);
    }
}

#[test]
fn a_text_answer_without_its_body_is_an_error() {
    let error = read_response::<Vec<u32>>(
        Query::tagged("test:text"),
        answer(json!({"status": "success", "value": {"etag": "\"x\""}})),
    )
    .unwrap_err();
    assert_eq!(error.to_string(), UNREADABLE_MESSAGE);
}

#[test]
fn function_errors_explain_themselves() {
    let error = read_response::<Value>(
        Query::value("test:value"),
        answer(json!({
            "status": "error",
            "errorMessage": "[Request ID: 1] Server Error\nUncaught ConvexError: {\"status\":400}",
            "errorData": {"status": 400, "error": "year must be a four-digit year"}
        })),
    )
    .unwrap_err();
    assert_eq!(
        error.to_string(),
        "MeetCal could not answer: year must be a four-digit year"
    );

    let error = read_response::<Value>(
        Query::value("test:value"),
        answer(json!({"status": "error", "errorMessage": "Server Error"})),
    )
    .unwrap_err();
    assert_eq!(error.to_string(), "MeetCal could not answer: Server Error");
}

#[test]
fn only_throttled_and_overloaded_responses_are_retryable() {
    assert!(is_retryable_status(TOO_MANY_REQUESTS));
    assert!(is_retryable_status(SERVICE_UNAVAILABLE));
    for status in [OK, 404, 500, 502, 504] {
        assert!(!is_retryable_status(status), "{status} must not retry");
    }
}

#[test]
fn retries_stop_after_the_limit() {
    for status in [TOO_MANY_REQUESTS, SERVICE_UNAVAILABLE] {
        assert!(should_retry(status, 0));
        assert!(should_retry(status, 1));
        assert!(!should_retry(status, MAX_RETRIES));
        assert!(!should_retry(status, MAX_RETRIES + 1));
    }
    assert!(!should_retry(500, 0));
    assert_eq!(MAX_RETRIES, 2);
}

#[test]
fn retry_after_seconds_are_honoured_within_bounds() {
    assert_eq!(retry_delay(Some("3")), Duration::from_secs(3));
    assert_eq!(retry_delay(Some(" 7 ")), Duration::from_secs(7));
    assert_eq!(retry_delay(Some("1")), Duration::from_secs(1));
    assert_eq!(retry_delay(Some("10")), Duration::from_secs(10));
}

#[test]
fn retry_after_is_clamped_to_one_through_ten_seconds() {
    assert_eq!(retry_delay(Some("0")), Duration::from_secs(1));
    assert_eq!(retry_delay(Some("11")), Duration::from_secs(10));
    assert_eq!(retry_delay(Some("3600")), Duration::from_secs(10));
    assert_eq!(
        retry_delay(Some("18446744073709551615")),
        Duration::from_secs(10)
    );
}

#[test]
fn missing_or_invalid_retry_after_falls_back_to_one_second() {
    for value in [
        None,
        Some(""),
        Some("soon"),
        Some("-5"),
        Some("1.5"),
        Some("Wed, 21 Oct 2015 07:28:00 GMT"),
    ] {
        assert_eq!(retry_delay(value), Duration::from_secs(1), "{value:?}");
    }
}

#[test]
fn unreadable_answers_never_name_the_function() {
    let error = read_response::<Vec<u32>>(
        Query::value("reference:standards"),
        answer(json!({"status": "success", "value": {"not": "a list"}})),
    )
    .unwrap_err();
    assert_eq!(error.to_string(), UNREADABLE_MESSAGE);

    let error = read_response::<Vec<u32>>(
        Query::tagged("reference:records"),
        answer(json!({"status": "success", "value": {"json": "not json"}})),
    )
    .unwrap_err();
    assert_eq!(error.to_string(), UNREADABLE_MESSAGE);

    assert!(!UNREADABLE_MESSAGE.contains(':'));
}

#[test]
fn a_revalidated_answer_is_kept_under_its_arguments_without_the_pass_or_the_tag() {
    let args = json!({"wso": "Carolina", "pass": "pass_1", "ifNoneMatch": "\"a\"", "gender": null, "ageCategory": "Open"});
    let same = json!({"ageCategory": "Open", "wso": "Carolina", "pass": "pass_2"});
    assert_eq!(
        answer_key("reference:wsoRecords", &args),
        answer_key("reference:wsoRecords", &same)
    );
    assert_ne!(
        answer_key("reference:wsoRecords", &args),
        answer_key(
            "reference:wsoRecords",
            &json!({"wso": "Texas", "ageCategory": "Open"})
        )
    );
    assert_ne!(
        answer_key("reference:records", &json!({})),
        answer_key("reference:standards", &json!({}))
    );
}

#[test]
fn an_unchanged_answer_reads_the_text_kept_under_its_tag() {
    let query = queries::RECORDS;
    let kept = KeptAnswer {
        etag: "\"v1\"".to_owned(),
        json: std::rc::Rc::from("[1,2]"),
    };
    let unchanged = TextAnswer {
        etag: Some("\"v1\"".to_owned()),
        json: None,
    };
    let (text, fresh) = text_of(query, unchanged, Some(kept.clone())).unwrap();
    assert_eq!(&*text, "[1,2]");
    assert!(fresh.is_none());

    let changed = TextAnswer {
        etag: Some("\"v2\"".to_owned()),
        json: Some("[3]".to_owned()),
    };
    let (text, fresh) = text_of(query, changed, Some(kept.clone())).unwrap();
    assert_eq!(&*text, "[3]");
    assert_eq!(fresh.map(|fresh| fresh.etag).as_deref(), Some("\"v2\""));

    let untagged = TextAnswer {
        etag: None,
        json: Some("[4]".to_owned()),
    };
    let (_, fresh) = text_of(query, untagged, None).unwrap();
    assert!(fresh.is_none(), "an answer without a tag is never kept");

    let other_tag = TextAnswer {
        etag: Some("\"v3\"".to_owned()),
        json: None,
    };
    assert!(text_of(query, other_tag, Some(kept)).is_err());
    let nothing_kept = TextAnswer {
        etag: Some("\"v1\"".to_owned()),
        json: None,
    };
    assert!(text_of(query, nothing_kept, None).is_err());
}

#[test]
fn only_queries_whose_convex_function_takes_a_tag_are_sent_one() {
    let convex = [
        include_str!("../../../../convex/reference.ts"),
        include_str!("../../../../convex/meets.ts"),
        include_str!("../../../../convex/results.ts"),
    ]
    .concat();
    for query in [
        queries::UPCOMING_MEETS,
        queries::COMPLETED_MEETS,
        queries::MEET_SCHEDULE,
        queries::MEET_ATHLETES,
        queries::MEET_RESULTS,
        queries::SEARCH,
        queries::RECORDS,
        queries::STANDARDS,
        queries::QUALIFYING_TOTALS,
        queries::INTL_RANKINGS,
        queries::NATIONAL_RANKINGS,
        queries::NATIONAL_RANKINGS_BY_YEAR,
        queries::WSO_LIST,
        queries::REGISTRATION_WSOS,
        queries::WSO_RECORDS,
        queries::ADAPTIVE_RECORDS,
        queries::CLUBS,
        queries::CLUB_MEETS,
        queries::CLUB_MEET_STATS,
        queries::WRAPPED,
    ] {
        let name = query.function.split(':').nth(1).unwrap();
        let start = convex
            .find(&format!("export const {name} = "))
            .unwrap_or_else(|| panic!("{} is not in convex/", query.function));
        let args = &convex[start..];
        let args = &args[..args.find("handler").unwrap()];
        assert_eq!(
            query.revalidates,
            args.contains("ifNoneMatch"),
            "{} revalidates unlike its Convex arguments",
            query.function
        );
    }
}

#[test]
fn requests_that_get_no_answer_explain_themselves_without_the_function() {
    assert_eq!(transport_message(true, false), TIMED_OUT_MESSAGE);
    assert_eq!(transport_message(true, true), TIMED_OUT_MESSAGE);
    assert_eq!(transport_message(false, true), OFFLINE_MESSAGE);
    assert_eq!(transport_message(false, false), UNREACHABLE_MESSAGE);
    for message in [TIMED_OUT_MESSAGE, OFFLINE_MESSAGE, UNREACHABLE_MESSAGE] {
        assert!(!message.contains(':'), "{message}");
    }
    assert_eq!(REQUEST_TIMEOUT, Duration::from_secs(20));
}

fn submission_error(status: f64, error: &str) -> QueryResponse {
    answer(json!({
        "status": "error",
        "errorMessage": "Server Error",
        "errorData": {"status": status, "error": error, "max": 5.0}
    }))
}

#[test]
fn meet_submissions_send_camel_case_with_absent_fields_as_null() {
    let submission = MeetSubmission {
        meet_name: "Ohio Open".to_owned(),
        start_date: "2026-11-14".to_owned(),
        end_date: None,
        contact_email: Some("lifter@example.com".to_owned()),
        files: vec![MeetSubmissionFile {
            storage_id: "kg2abc".to_owned(),
            name: "schedule.pdf".to_owned(),
        }],
    };
    assert_eq!(
        serde_json::to_value(&submission).unwrap(),
        json!({
            "meetName": "Ohio Open",
            "startDate": "2026-11-14",
            "endDate": null,
            "contactEmail": "lifter@example.com",
            "files": [{"storageId": "kg2abc", "name": "schedule.pdf"}]
        })
    );
}

#[test]
fn upload_urls_and_storage_ids_are_read_from_their_answers() {
    let url = "https://disciplined-hare-790.convex.cloud/api/storage/upload?token=abc";
    assert_eq!(
        read_upload_url(answer(
            json!({"status": "success", "value": {"uploadUrl": url}})
        ))
        .unwrap(),
        url
    );
    for value in [
        json!({}),
        json!({"uploadUrl": ""}),
        json!({"uploadUrl": "http://x"}),
    ] {
        let error = read_upload_url(answer(json!({"status": "success", "value": value})))
            .unwrap_err()
            .to_string();
        assert_eq!(error, UNREADABLE_MESSAGE);
    }

    assert_eq!(
        read_storage_id(br#"{"storageId":"kg2abc"}"#).unwrap(),
        "kg2abc"
    );
    for body in [&b""[..], b"not json", br#"{}"#, br#"{"storageId":""}"#] {
        assert_eq!(
            read_storage_id(body).unwrap_err().to_string(),
            UNREADABLE_MESSAGE
        );
    }
}

#[test]
fn a_submission_is_done_only_when_the_server_says_so() {
    assert!(
        read_submitted(answer(
            json!({"status": "success", "value": {"submitted": true}})
        ))
        .is_ok_and(|outcome| outcome == MeetSubmissionOutcome::Submitted)
    );
    let error = read_submitted(answer(json!({"status": "success", "value": {}})))
        .unwrap_err()
        .to_string();
    assert_eq!(error, UNREADABLE_MESSAGE);
}

#[test]
fn files_already_in_a_submission_are_known_by_the_servers_code_not_its_words() {
    let coded = answer(json!({
        "status": "error",
        "errorMessage": "Server Error",
        "errorData": {"status": 400.0, "error": "file already submitted: a.pdf", "code": "already_submitted"}
    }));
    assert_eq!(
        read_submitted(coded).unwrap(),
        MeetSubmissionOutcome::FilesAlreadySubmitted {
            server_said: "File already submitted: a.pdf".to_owned()
        }
    );
    let reworded = answer(json!({
        "status": "error",
        "errorMessage": "Server Error",
        "errorData": {"status": 400.0, "error": "that file is in another submission", "code": "already_submitted"}
    }));
    assert!(matches!(
        read_submitted(reworded),
        Ok(MeetSubmissionOutcome::FilesAlreadySubmitted { .. })
    ));
    let same_words_without_the_code = submission_error(400.0, "file already submitted: a.pdf");
    assert_eq!(
        read_submitted(same_words_without_the_code)
            .unwrap_err()
            .to_string(),
        "File already submitted: a.pdf"
    );
}

#[test]
fn an_upload_is_cancelled_after_the_same_silence_as_the_apps() {
    let app = include_str!("../../../../src/lib/meet-submission.ts");
    let millis = UPLOAD_SILENCE_LIMIT.as_millis();
    let spelled = format!("{}_{:03}", millis / 1000, millis % 1000);
    assert!(
        app.contains(&format!(
            "MEET_SUBMISSION_UPLOAD_SILENCE_LIMIT_MS = {spelled};"
        )),
        "UPLOAD_SILENCE_LIMIT differs from the app's"
    );
}

#[test]
fn the_already_submitted_code_is_the_servers() {
    let server = include_str!("../../../../convex/lib/meetSubmissions.ts");
    assert!(server.contains(&format!(
        "FILE_ALREADY_SUBMITTED_CODE = '{FILE_ALREADY_SUBMITTED_CODE}'"
    )));
}

#[test]
fn submission_errors_read_as_sentences_a_user_can_act_on() {
    let message = |response| read_submitted(response).unwrap_err().to_string();
    assert_eq!(
        message(submission_error(400.0, "end date is before the start date")),
        "End date is before the start date"
    );
    assert_eq!(
        message(submission_error(
            413.0,
            "file is larger than 20 MB: big.pdf"
        )),
        "File is larger than 20 MB: big.pdf"
    );
    assert_eq!(
        message(submission_error(429.0, "at most 5 meet submissions a day")),
        "At most 5 meet submissions a day. Please try again tomorrow."
    );
    assert_eq!(
        read_upload_url(submission_error(429.0, "at most 50 uploads a day"))
            .unwrap_err()
            .to_string(),
        "At most 50 uploads a day. Please try again tomorrow."
    );
    assert_eq!(
        message(submission_error(401.0, "unauthorized")),
        SESSION_MESSAGE
    );
    assert_eq!(
        read_upload_url(submission_error(401.0, "unauthorized"))
            .unwrap_err()
            .to_string(),
        SESSION_MESSAGE
    );
    assert_eq!(
        message(submission_error(500.0, "boom")),
        "MeetCal could not answer: boom"
    );
}

#[test]
fn exhausted_retries_explain_the_failure() {
    assert_eq!(
        exhausted_retries_message(TOO_MANY_REQUESTS),
        RATE_LIMITED_MESSAGE
    );
    assert_eq!(
        exhausted_retries_message(SERVICE_UNAVAILABLE),
        OVERLOADED_MESSAGE
    );
}

fn builder_error(status: f64, error: &str) -> QueryResponse {
    answer(json!({
        "status": "error",
        "errorMessage": "Server Error",
        "errorData": { "status": status, "error": error }
    }))
}

#[test]
fn schedule_builder_errors_show_the_servers_sentence() {
    let message = |response| {
        read_builder_answer::<Value>(BUILDER_LOAD, response)
            .unwrap_err()
            .to_string()
    };
    assert_eq!(
        message(builder_error(
            422.0,
            "Sport80 hasn't set this meet's dates yet"
        )),
        "Sport80 hasn't set this meet's dates yet"
    );
    assert_eq!(
        message(builder_error(429.0, "at most 10 schedule publishes a day")),
        "At most 10 schedule publishes a day"
    );
    assert_eq!(
        message(builder_error(401.0, "unauthorized")),
        SESSION_MESSAGE
    );
    assert_eq!(
        message(answer(json!({ "status": "error", "errorMessage": "boom" }))),
        "MeetCal could not answer: boom"
    );
    let loaded: LoadedMeet = read_builder_answer(
        BUILDER_LOAD,
        answer(
            json!({ "status": "success", "value": { "meet": "Turkey Cup", "refreshed": true } }),
        ),
    )
    .unwrap();
    assert_eq!(loaded.meet, "Turkey Cup");
}

#[test]
fn schedule_options_and_edits_are_sent_as_convex_validates_them() {
    let options = BuilderOptions {
        days: vec![BuilderDay {
            date: "2026-11-14".to_owned(),
            first_start: "09:00".to_owned(),
        }],
        session_minutes: 120,
        break_minutes: 0,
        max_athletes_per_platform: 15,
        max_sessions_per_day: None,
        platforms: vec!["Red".to_owned()],
        grouping: Grouping::EntryTotal,
        separate_age_groups: true,
        order: SessionOrder::WomenDayMenDay,
    };
    assert_eq!(
        serde_json::to_value(&options).unwrap(),
        json!({
            "days": [{ "date": "2026-11-14", "firstStart": "09:00" }],
            "sessionMinutes": 120,
            "breakMinutes": 0,
            "maxAthletesPerPlatform": 15,
            "maxSessionsPerDay": null,
            "platforms": ["Red"],
            "grouping": "entryTotal",
            "separateAgeGroups": true,
            "order": "womenDayMenDay"
        })
    );
    let edits = vec![
        BuilderEdit::MoveAthlete {
            athlete: "1|ann".to_owned(),
            from_session: Some(1),
            from_platform: Some("Blue".to_owned()),
            occurrence: Some(1),
            to_session: 2,
            to_platform: "Red".to_owned(),
        },
        BuilderEdit::MoveClass {
            from_session: 1,
            from_platform: "Red".to_owned(),
            weight_class: "48".to_owned(),
            to_session: 2,
            to_platform: "Blue".to_owned(),
        },
        BuilderEdit::SwapSessions {
            session: 1,
            with_session: 2,
        },
        BuilderEdit::SetSessionTime {
            session: 1,
            date: "2026-11-14".to_owned(),
            start_time: "10:30".to_owned(),
        },
    ];
    let sent = serde_json::to_value(&edits).unwrap();
    assert_eq!(
        sent,
        json!([
            { "kind": "moveAthlete", "athlete": "1|ann", "fromSession": 1, "fromPlatform": "Blue", "occurrence": 1, "toSession": 2, "toPlatform": "Red" },
            { "kind": "moveClass", "fromSession": 1, "fromPlatform": "Red", "weightClass": "48", "toSession": 2, "toPlatform": "Blue" },
            { "kind": "swapSessions", "session": 1, "withSession": 2 },
            { "kind": "setSessionTime", "session": 1, "date": "2026-11-14", "startTime": "10:30" }
        ])
    );
    let stored: Vec<BuilderEdit> = serde_json::from_value(whole_numbers_as_integers(
        json!([{ "kind": "swapSessions", "session": 1.0, "withSession": 2.0 }]),
    ))
    .unwrap();
    assert_eq!(stored.first(), edits.get(2));
    let saved_before_moves_named_their_source: BuilderEdit = serde_json::from_value(json!(
        { "kind": "moveAthlete", "athlete": "1|ann", "toSession": 2, "toPlatform": "Red" }
    ))
    .unwrap();
    assert_eq!(
        serde_json::to_value(&saved_before_moves_named_their_source).unwrap(),
        json!({ "kind": "moveAthlete", "athlete": "1|ann", "toSession": 2, "toPlatform": "Red" })
    );
}

#[test]
fn meet_searches_read_each_match_and_its_entries_list() {
    let found: MeetMatches = read_builder_answer(
        BUILDER_SEARCH,
        answer(json!({ "status": "success", "value": {
            "results": [
                { "eventId": "15084", "name": "Turkey Cup", "startDate": "2026-11-21", "endDate": "2026-11-21", "place": "Saint Joseph, Missouri", "entriesUrl": "https://usaweightlifting.sport80.com/public/events/15084/entries/21962" },
                { "eventId": "15090", "name": "Turkey Open", "startDate": "", "endDate": "", "place": "", "entriesUrl": null }
            ],
            "truncated": true
        } })),
    )
    .unwrap();
    assert!(found.truncated);
    assert_eq!(
        found
            .results
            .iter()
            .map(|found| found.entries_url.is_some())
            .collect::<Vec<_>>(),
        [true, false]
    );
    assert_eq!(found.results[0].event_id, "15084");
}

#[test]
fn exported_workbooks_decode_from_base64() {
    assert_eq!(decode_base64("UEsDBA==").unwrap(), b"PK\x03\x04");
    assert_eq!(decode_base64("YWJj").unwrap(), b"abc");
    assert_eq!(decode_base64("YWI=").unwrap(), b"ab");
    assert_eq!(decode_base64("").unwrap(), b"");
    assert_eq!(decode_base64("YW Jj\n").unwrap(), b"abc");
    for broken in ["YWJ", "Y===", "YQ==YWJj", "YW=j", "YW*j"] {
        assert_eq!(decode_base64(broken), None, "{broken}");
    }
    let workbook = ExportFile {
        file_name: "turkey-cup-schedule.xlsx".to_owned(),
        content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            .to_owned(),
        encoding: ExportEncoding::Base64,
        content: "UEsDBA==".to_owned(),
    };
    assert_eq!(workbook.bytes().unwrap(), b"PK\x03\x04");
    let csv = ExportFile {
        encoding: ExportEncoding::Utf8,
        content: "\u{feff}Session".to_owned(),
        ..workbook
    };
    assert_eq!(csv.bytes().unwrap(), "\u{feff}Session".as_bytes());
}

fn kept(etag: &str) -> KeptAnswer {
    KeptAnswer {
        etag: etag.to_owned(),
        json: std::rc::Rc::from("[]"),
    }
}

#[test]
fn answers_kept_in_memory_stop_at_the_limit_dropping_the_least_recently_used() {
    let mut memory = KeptInMemory::default();
    for index in 0..MAX_ANSWERS_KEPT_IN_MEMORY {
        memory.insert(format!("query:{index}"), kept(&index.to_string()), false);
    }
    assert!(memory.get("query:0").is_some());
    memory.insert("query:new".to_owned(), kept("new"), false);

    assert!(memory.get("query:0").is_some());
    assert!(memory.get("query:1").is_none());
    assert!(memory.get("query:new").is_some());
    let kept_now = (0..MAX_ANSWERS_KEPT_IN_MEMORY)
        .filter(|index| memory.get(&format!("query:{index}")).is_some())
        .count()
        + 1;
    assert_eq!(kept_now, MAX_ANSWERS_KEPT_IN_MEMORY);
}

#[test]
fn signing_out_drops_only_the_premium_answers_kept_in_memory() {
    let mut memory = KeptInMemory::default();
    memory.insert("meets:list:[]".to_owned(), kept("public"), false);
    memory.insert("reference:records:[]".to_owned(), kept("premium"), true);
    memory.forget_premium();
    assert!(memory.get("meets:list:[]").is_some());
    assert!(memory.get("reference:records:[]").is_none());
}

#[test]
fn a_store_read_that_never_answers_is_given_up_when_the_wait_runs_out() {
    use futures::FutureExt;
    let hung = futures::future::pending::<&str>();
    let wait_over = futures::future::ready(());
    assert_eq!(first_or_none(hung, wait_over).now_or_never(), Some(None));
}

#[test]
fn a_store_read_that_answers_in_time_is_used() {
    use futures::FutureExt;
    let answered = futures::future::ready("stored");
    let still_waiting = futures::future::pending::<()>();
    assert_eq!(
        first_or_none(answered, still_waiting).now_or_never(),
        Some(Some("stored"))
    );
}

#[test]
fn after_the_store_timed_out_reads_skip_it_for_a_while_then_try_again() {
    let timed_out_at = 1_000.0;
    assert!(may_read_store(None, timed_out_at));
    assert!(!may_read_store(Some(timed_out_at), timed_out_at + 1.0));
    assert!(!may_read_store(
        Some(timed_out_at),
        timed_out_at + STORE_RETRY_AFTER_MS - 1.0
    ));
    assert!(may_read_store(
        Some(timed_out_at),
        timed_out_at + STORE_RETRY_AFTER_MS
    ));
}
