//! `/link`: approve (or deny) a `meetcal login` on a phone.
//!
//! The CLI shows a code and a link to `/link?code=…` (also as a QR code) and
//! waits. Here the signed-in user sees which device asked, and approves or
//! denies it; Convex then hands the CLI its token (`convex/deviceLogin.ts`).
//! The page needs a signed-in user but no subscription. The URL holds the
//! code, so Clerk's sign-in, a reload and the back button all return to it.

use crate::auth::{AuthContext, AuthState};
use crate::components::subscription_gate::{AccessShell, ClerkSignIn};
use crate::utils::api::{self, DeviceLoginOutcome, PendingDeviceLogin};
use leptos::prelude::*;
use leptos::task::spawn_local;
use leptos_router::components::A;
use leptos_router::hooks::{use_navigate, use_query_map};

/// Letters in a code; the CLI shows them as two groups of four. Codes are
/// letters only (`USER_CODE_ALPHABET` in `convex/deviceLogin.ts`), and the
/// server drops anything else, so the field does too.
pub const USER_CODE_LENGTH: usize = 8;
const USER_CODE_GROUP: usize = 4;

/// Longest device name shown, in characters. The name is the CLI's to
/// choose, so a long one cannot push the warning off the screen.
const MAX_DEVICE_NAME_CHARS: usize = 60;

/// A code as the user types it: ASCII letters only, uppercase, at most
/// `USER_CODE_LENGTH` of them, with a dash after the first group
/// (`wxyz bc` becomes `WXYZ-BC`). The server ignores case, spaces and the dash.
pub fn format_user_code(input: &str) -> String {
    let mut code = String::with_capacity(USER_CODE_LENGTH + 1);
    let characters = input
        .chars()
        .filter(char::is_ascii_alphabetic)
        .map(|character| character.to_ascii_uppercase())
        .take(USER_CODE_LENGTH);
    for (index, character) in characters.enumerate() {
        if index == USER_CODE_GROUP {
            code.push('-');
        }
        code.push(character);
    }
    code
}

/// The formatted code, if `input` holds a whole one (and nothing more).
pub fn complete_user_code(input: &str) -> Option<String> {
    let characters = input.chars().filter(char::is_ascii_alphabetic).count();
    (characters == USER_CODE_LENGTH).then(|| format_user_code(input))
}

/// Where the caret goes once `typed` is formatted, when it stood at UTF-16
/// offset `caret` (as the browser counts): after the same letter.
fn formatted_caret(typed: &str, caret: usize) -> usize {
    let before = char::decode_utf16(typed.encode_utf16().take(caret))
        .filter_map(Result::ok)
        .filter(char::is_ascii_alphabetic)
        .count()
        .min(USER_CODE_LENGTH);
    if before > USER_CODE_GROUP {
        before + 1
    } else {
        before
    }
}

/// The page's address for a formatted code (letters and a dash, so
/// nothing to escape).
pub fn link_url(code: &str) -> String {
    format!("/link?code={code}")
}

/// How long ago a login was requested, for "Requested 2 minutes ago".
fn requested_ago(created_at: f64, now: f64) -> String {
    let minutes = ((now - created_at) / 60_000.0).floor();
    if minutes < 1.0 {
        return "just now".to_owned();
    }
    let (count, unit) = if minutes < 60.0 {
        (minutes, "minute")
    } else if minutes < 48.0 * 60.0 {
        ((minutes / 60.0).floor(), "hour")
    } else {
        ((minutes / (24.0 * 60.0)).floor(), "day")
    };
    let plural = if count == 1.0 { "" } else { "s" };
    format!("{count} {unit}{plural} ago")
}

/// The device name to show: one line, at most `MAX_DEVICE_NAME_CHARS`.
fn display_device_name(name: &str) -> String {
    let name = name
        .split(|character: char| character.is_whitespace() || character.is_control())
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if name.is_empty() {
        return "Unnamed device".to_owned();
    }
    if name.chars().count() <= MAX_DEVICE_NAME_CHARS {
        return name;
    }
    let mut shortened = name
        .chars()
        .take(MAX_DEVICE_NAME_CHARS - 1)
        .collect::<String>();
    shortened.push('…');
    shortened
}

#[component]
pub fn LinkPage() -> impl IntoView {
    let auth = expect_context::<AuthContext>();
    let query = use_query_map();
    let typed = Memo::new(move |_| query.with(|params| params.get("code").unwrap_or_default()));
    let code = Memo::new(move |_| complete_user_code(&typed.get()));

    view! {
        <AccessShell>
            {move || match auth.state.get() {
                AuthState::Loading => view! {
                    <div class="access-status" role="status" aria-live="polite">
                        <span class="access-spinner" aria-hidden="true"></span>
                        <h1>"Checking your sign-in"</h1>
                    </div>
                }.into_any(),
                AuthState::SignedOut => view! {
                    <div class="access-heading">
                        <p class="data-eyebrow">"MeetCal CLI"</p>
                        <h1>"Sign in to continue"</h1>
                        <p>"Sign in to your MeetCal account to approve " <code>"meetcal login"</code> "."</p>
                    </div>
                    <ClerkSignIn />
                }.into_any(),
                AuthState::ConfigurationError(message) => view! {
                    <div class="access-status access-error" role="alert">
                        <h1>"Sign-in isn’t available"</h1>
                        <p>{message}</p>
                        <button class="access-button" type="button" on:click=move |_| reload()>
                            "Try again"
                        </button>
                    </div>
                }.into_any(),
                AuthState::SignedIn(_) => view! {
                    {move || match code.get() {
                        Some(code) => view! { <ApproveCode code /> }.into_any(),
                        None => view! {
                            <CodeEntry initial=format_user_code(&typed.get_untracked()) />
                        }.into_any(),
                    }}
                }.into_any(),
            }}
        </AccessShell>
    }
}

fn reload() {
    if let Some(window) = web_sys::window() {
        let _ = window.location().reload();
    }
}

/// Asks for the code when the link had none (or only part of one), then
/// moves to the code's address.
#[component]
fn CodeEntry(initial: String) -> impl IntoView {
    let navigate = use_navigate();
    let (value, set_value) = signal(initial);
    let (incomplete, set_incomplete) = signal(false);

    view! {
        <div class="access-heading">
            <p class="data-eyebrow">"MeetCal CLI"</p>
            <h1>"Enter your code"</h1>
            <p>"Type the code " <code>"meetcal login"</code> " shows in your terminal."</p>
        </div>
        <form
            class="link-code-form"
            novalidate=true
            on:submit=move |event| {
                event.prevent_default();
                match complete_user_code(&value.get_untracked()) {
                    Some(code) => navigate(&link_url(&code), Default::default()),
                    None => set_incomplete.set(true),
                }
            }
        >
            <label for="link-code">"Code"</label>
            <input
                id="link-code"
                class="link-code-input"
                type="text"
                autocomplete="off"
                autocapitalize="characters"
                spellcheck="false"
                placeholder="ABCD-EFGH"
                aria-describedby="link-code-help"
                aria-invalid=move || incomplete.get().then_some("true")
                prop:value=value
                on:input=move |event| {
                    let input = event_target::<web_sys::HtmlInputElement>(&event);
                    let typed = input.value();
                    let formatted = format_user_code(&typed);
                    if formatted != typed {
                        // Set the field itself (a ninth character formats to
                        // the value already held, which would not update it),
                        // keeping the caret after the same character.
                        let caret = input
                            .selection_start()
                            .ok()
                            .flatten()
                            .map_or(formatted.len(), |caret| {
                                formatted_caret(&typed, caret as usize)
                            });
                        input.set_value(&formatted);
                        let caret = caret as u32;
                        let _ = input.set_selection_range(caret, caret);
                    }
                    set_value.set(formatted);
                    set_incomplete.set(false);
                }
            />
            {move || if incomplete.get() {
                view! {
                    <p id="link-code-help" class="access-inline-error" role="alert">
                        "Enter all 8 letters of the code."
                    </p>
                }.into_any()
            } else {
                view! { <p id="link-code-help" class="link-code-help">"8 letters, like ABCD-EFGH."</p> }.into_any()
            }}
            <button class="access-button" type="submit">"Continue"</button>
        </form>
    }
}

/// Where the approval of one code stands.
#[derive(Clone, Debug, PartialEq)]
enum Step {
    Looking,
    /// Waiting for the user's answer (the login is in `login`).
    Pending,
    Approving,
    Denying,
    Approved,
    Denied,
    /// Expired, already used, or never issued.
    Gone,
    Failed {
        message: String,
        retry: Action,
    },
}

/// A call to Convex the page makes, and makes again on Try again.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Action {
    Describe,
    Approve,
    Deny,
}

/// What a finished call leaves the page showing.
fn step_after(action: Action, result: Result<DeviceLoginOutcome, String>) -> Step {
    match (action, result) {
        (_, Err(message)) => Step::Failed {
            message,
            retry: action,
        },
        (Action::Approve, Ok(DeviceLoginOutcome::Done)) => Step::Approved,
        // Denying a code that is already gone leaves the CLI unsigned all the same.
        (Action::Deny, Ok(_)) => Step::Denied,
        (Action::Describe, Ok(DeviceLoginOutcome::Done)) => Step::Pending,
        (_, Ok(DeviceLoginOutcome::Gone)) => Step::Gone,
    }
}

/// Looks up `code`, then approves or denies it. A new code builds a new one;
/// a call still running for the old one finds its signals gone and is dropped.
#[component]
fn ApproveCode(code: String) -> impl IntoView {
    let step = RwSignal::new(Step::Looking);
    let login = RwSignal::new(None::<PendingDeviceLogin>);
    let code = StoredValue::new(code);

    let run = move |action: Action| {
        step.set(match action {
            Action::Describe => Step::Looking,
            Action::Approve => Step::Approving,
            Action::Deny => Step::Denying,
        });
        let code = code.get_value();
        spawn_local(async move {
            let result = match action {
                Action::Describe => api::describe_device_login(&code).await.map(|found| {
                    let outcome = if found.is_some() {
                        DeviceLoginOutcome::Done
                    } else {
                        DeviceLoginOutcome::Gone
                    };
                    login.try_set(found);
                    outcome
                }),
                Action::Approve => api::approve_device_login(&code).await,
                Action::Deny => api::deny_device_login(&code).await,
            };
            step.try_set(step_after(
                action,
                result.map_err(|error| error.to_string()),
            ));
        });
    };
    run(Action::Describe);

    view! {
        {move || match step.get() {
            Step::Looking => view! {
                <div class="access-status" role="status" aria-live="polite">
                    <span class="access-spinner" aria-hidden="true"></span>
                    <h1>"Looking up your code"</h1>
                    <p><code>{code.get_value()}</code></p>
                </div>
            }.into_any(),
            current @ (Step::Pending | Step::Approving | Step::Denying) => {
                let busy = current != Step::Pending;
                let approving = current == Step::Approving;
                let denying = current == Step::Denying;
                let (device, ago) = login.with_untracked(|login| {
                    login.as_ref().map_or_else(
                        || ("Unnamed device".to_owned(), "just now".to_owned()),
                        |login| (
                            display_device_name(&login.device_name),
                            requested_ago(login.created_at, js_sys::Date::now()),
                        ),
                    )
                });
                view! {
                    <div class="access-heading">
                        <p class="data-eyebrow">"MeetCal CLI"</p>
                        <h1>"Sign in the MeetCal CLI?"</h1>
                        <p>"A device is asking to sign in to your MeetCal account."</p>
                    </div>
                    <dl class="link-details">
                        <div><dt>"Device"</dt><dd class="link-device">{device}</dd></div>
                        <div><dt>"Code"</dt><dd><code>{code.get_value()}</code></dd></div>
                        <div><dt>"Requested"</dt><dd>{ago}</dd></div>
                    </dl>
                    <div class="link-warning" role="note">
                        <strong>"Only approve if you just ran " <code>"meetcal login"</code> " yourself"</strong>
                        " and this code matches your terminal. If someone sent you this link, tap Deny."
                    </div>
                    <div class="link-actions" aria-busy=move || busy.then_some("true")>
                        <button class="access-button" type="button" disabled=busy on:click=move |_| run(Action::Approve)>
                            {if approving { "Approving…" } else { "Approve" }}
                        </button>
                        <button class="access-button access-button-secondary" type="button" disabled=busy on:click=move |_| run(Action::Deny)>
                            {if denying { "Denying…" } else { "Deny" }}
                        </button>
                    </div>
                }.into_any()
            }
            Step::Approved => view! {
                <div class="access-status link-result" role="status" aria-live="polite">
                    <span class="link-result-icon" aria-hidden="true">"✓"</span>
                    <h1>"CLI signed in"</h1>
                    <p>"Done — you can return to your terminal."</p>
                </div>
            }.into_any(),
            Step::Denied => view! {
                <div class="access-status link-result" role="status" aria-live="polite">
                    <h1>"Request denied"</h1>
                    <p>"That device was not signed in. You can close this page."</p>
                </div>
            }.into_any(),
            Step::Gone => view! {
                <div class="access-status link-result" role="status" aria-live="polite">
                    <h1>"Code expired"</h1>
                    <p>"This code has expired or was already used. Run " <code>"meetcal login"</code> " again."</p>
                    <A href="/link" attr:class="access-button access-button-secondary">"Enter another code"</A>
                </div>
            }.into_any(),
            Step::Failed { message, retry } => view! {
                <div class="access-status access-error" role="alert">
                    <h1>"Something went wrong"</h1>
                    <p>{message}</p>
                    <button class="access-button" type="button" on:click=move |_| run(retry)>
                        "Try again"
                    </button>
                </div>
            }.into_any(),
        }}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINUTE: f64 = 60_000.0;

    #[test]
    fn typed_codes_are_uppercased_and_grouped_with_one_dash() {
        assert_eq!(format_user_code(""), "");
        assert_eq!(format_user_code("w"), "W");
        assert_eq!(format_user_code("wxyz"), "WXYZ");
        assert_eq!(format_user_code("wxyzb"), "WXYZ-B");
        assert_eq!(format_user_code("wxyzbcdf"), "WXYZ-BCDF");
        assert_eq!(format_user_code(" wx yz - bc df "), "WXYZ-BCDF");
        assert_eq!(format_user_code("WXYZ-BCDF"), "WXYZ-BCDF");
        assert_eq!(format_user_code("wxyz--bc.df"), "WXYZ-BCDF");
        // A ninth letter is dropped; so is anything but ASCII letters,
        // digits included (codes have none, and the server drops them).
        assert_eq!(format_user_code("WXYZ-BCDFG"), "WXYZ-BCDF");
        assert_eq!(format_user_code("ÄWXYZBCDF"), "WXYZ-BCDF");
        assert_eq!(format_user_code("WXYZ-4821"), "WXYZ");
        assert_eq!(format_user_code("<b>WXYZ</b>"), "BWXY-ZB");
    }

    #[test]
    fn only_a_whole_code_is_complete() {
        assert_eq!(
            complete_user_code("wxyz-bcdf"),
            Some("WXYZ-BCDF".to_owned())
        );
        assert_eq!(
            complete_user_code("WXYZ BCDF"),
            Some("WXYZ-BCDF".to_owned())
        );
        assert_eq!(complete_user_code("wxyzbcdf"), Some("WXYZ-BCDF".to_owned()));
        for partial in ["", "WXYZ", "WXYZ-BCD", "WXYZ-BCDFG", "----", "WXYZ-4821"] {
            assert_eq!(complete_user_code(partial), None, "{partial}");
        }
    }

    #[test]
    fn the_caret_stays_after_the_character_it_followed() {
        // Typed at the end.
        assert_eq!(formatted_caret("wxyzb", 5), 6);
        assert_eq!(formatted_caret("wxyz", 4), 4);
        // A typo fixed in the middle: `WXqYZ-BCDF` has q after X.
        assert_eq!(formatted_caret("WXqYZ-BCDF", 3), 3);
        // After the dash's own group, the dash counts.
        assert_eq!(formatted_caret("WXYZ-BCqDF", 8), 8);
        // A space or dash typed moves nothing.
        assert_eq!(formatted_caret("WX YZ", 3), 2);
        // Never past the code.
        assert_eq!(formatted_caret("WXYZ-BCDFG", 10), 9);
        // A digit typed moves nothing either.
        assert_eq!(formatted_caret("WX4YZ", 3), 2);
        assert_eq!(formatted_caret("ÄWXYZ", 2), 1);
        assert_eq!(formatted_caret("", 0), 0);
    }

    #[test]
    fn a_code_links_to_its_own_address() {
        assert_eq!(link_url("WXYZ-BCDF"), "/link?code=WXYZ-BCDF");
    }

    #[test]
    fn request_times_read_as_how_long_ago() {
        let now = 1_800_000_000_000.0;
        assert_eq!(requested_ago(now, now), "just now");
        assert_eq!(requested_ago(now - 59_000.0, now), "just now");
        // A device clock behind the server's is still "just now".
        assert_eq!(requested_ago(now + 5.0 * MINUTE, now), "just now");
        assert_eq!(requested_ago(now - MINUTE, now), "1 minute ago");
        assert_eq!(requested_ago(now - 2.5 * MINUTE, now), "2 minutes ago");
        assert_eq!(requested_ago(now - 59.0 * MINUTE, now), "59 minutes ago");
        assert_eq!(requested_ago(now - 60.0 * MINUTE, now), "1 hour ago");
        assert_eq!(requested_ago(now - 150.0 * MINUTE, now), "2 hours ago");
        assert_eq!(
            requested_ago(now - 3.0 * 24.0 * 60.0 * MINUTE, now),
            "3 days ago"
        );
    }

    #[test]
    fn device_names_show_on_one_short_line() {
        assert_eq!(display_device_name("maddisen-laptop"), "maddisen-laptop");
        assert_eq!(
            display_device_name("  Claude Code\n on\tlaptop "),
            "Claude Code on laptop"
        );
        assert_eq!(display_device_name(" \n "), "Unnamed device");
        let long = "x".repeat(200);
        let shown = display_device_name(&long);
        assert_eq!(shown.chars().count(), MAX_DEVICE_NAME_CHARS);
        assert!(shown.ends_with('…'));
        let exact = "y".repeat(MAX_DEVICE_NAME_CHARS);
        assert_eq!(display_device_name(&exact), exact);
    }

    #[test]
    fn each_answer_moves_the_page_on() {
        use DeviceLoginOutcome::{Done, Gone};
        assert_eq!(step_after(Action::Describe, Ok(Done)), Step::Pending);
        assert_eq!(step_after(Action::Describe, Ok(Gone)), Step::Gone);
        assert_eq!(step_after(Action::Approve, Ok(Done)), Step::Approved);
        assert_eq!(step_after(Action::Approve, Ok(Gone)), Step::Gone);
        assert_eq!(step_after(Action::Deny, Ok(Done)), Step::Denied);
        assert_eq!(step_after(Action::Deny, Ok(Gone)), Step::Denied);
        for action in [Action::Describe, Action::Approve, Action::Deny] {
            assert_eq!(
                step_after(action, Err("offline".to_owned())),
                Step::Failed {
                    message: "offline".to_owned(),
                    retry: action
                }
            );
        }
    }
}
