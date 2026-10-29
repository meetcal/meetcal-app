//! `/submit-meet`: send MeetCal the schedule and start lists of a meet it
//! does not cover yet.
//!
//! A signed-in user names the meet, gives its dates and picks 1 to 10 files.
//! Each file is uploaded in turn to a one-time URL, then the meet is
//! submitted with the files' storage ids (`convex/meetSubmissions.ts`), and
//! the owner gets an email with a link to each file. The checks below are
//! the server's (`convex/lib/meetSubmissions.ts`), made before anything is
//! uploaded. The page needs a signed-in user but no subscription.

use crate::auth::{AuthContext, AuthState};
use crate::components::subscription_gate::ClerkSignIn;
use crate::utils::api::{self, MeetSubmission, MeetSubmissionFile};
use leptos::prelude::*;
use leptos::task::spawn_local;
use std::collections::HashMap;
use wasm_bindgen_futures::JsFuture;

/// Files one submission may carry.
pub const MAX_FILES: usize = 10;
/// Largest file, in bytes (`File.size` is a float).
pub const MAX_FILE_BYTES: f64 = 20.0 * 1024.0 * 1024.0;
/// Longest meet name and file name, in characters, once trimmed.
pub const MAX_MEET_NAME_CHARS: usize = 200;
pub const MAX_FILE_NAME_CHARS: usize = 200;
/// Schedules and start lists come as PDFs, photos, spreadsheets and Word
/// documents: the server's `MEET_SUBMISSION_FILE_EXTENSIONS`.
pub const FILE_EXTENSIONS: [&str; 12] = [
    "pdf", "jpg", "jpeg", "png", "heic", "heif", "webp", "xlsx", "xls", "csv", "doc", "docx",
];
/// The file picker's `accept`: `FILE_EXTENSIONS`, each with its dot.
pub const ACCEPT: &str = ".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,.xlsx,.xls,.csv,.doc,.docx";

/// A picked file's name and size, all the checks need.
#[derive(Clone, Debug, PartialEq)]
pub struct FileInfo {
    pub name: String,
    pub size: f64,
}

/// A submission that passed the checks, trimmed as the server trims it.
#[derive(Clone, Debug, PartialEq)]
pub struct CheckedSubmission {
    pub meet_name: String,
    pub start_date: String,
    pub end_date: Option<String>,
    /// Each file's trimmed name, in the order picked.
    pub file_names: Vec<String>,
}

/// A file name's extension, lowercase, or "" for none (also for a name that
/// starts or ends with its only dot), as the server reads it.
pub fn file_extension(name: &str) -> String {
    match name.rfind('.') {
        Some(dot) if dot > 0 && dot < name.len() - 1 => name[dot + 1..].to_lowercase(),
        _ => String::new(),
    }
}

/// Why a picked file cannot be sent, if it cannot.
pub fn file_problem(file: &FileInfo) -> Option<&'static str> {
    let name = file.name.trim();
    if name.is_empty() {
        Some("The file has no name")
    } else if name.chars().count() > MAX_FILE_NAME_CHARS {
        Some("File names must be 200 characters or fewer")
    } else if !FILE_EXTENSIONS.contains(&file_extension(name).as_str()) {
        Some("Only PDFs, photos, spreadsheets and Word documents can be sent")
    } else if file.size > MAX_FILE_BYTES {
        Some("Each file must be 20 MB or smaller")
    } else {
        None
    }
}

/// Whether `value` is a real calendar date written `YYYY-MM-DD`.
pub fn is_iso_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    let number = |range: std::ops::Range<usize>| -> Option<u32> {
        let part = &value[range];
        part.bytes()
            .all(|byte| byte.is_ascii_digit())
            .then(|| part.parse().ok())
            .flatten()
    };
    let (Some(year), Some(month), Some(day)) = (number(0..4), number(5..7), number(8..10)) else {
        return false;
    };
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&day)
}

/// Checks a submission before anything is uploaded: the server's checks, in
/// its order, with messages for the form. `end_date` may be blank.
pub fn check_submission(
    meet_name: &str,
    start_date: &str,
    end_date: &str,
    files: &[FileInfo],
) -> Result<CheckedSubmission, String> {
    let meet_name = meet_name.trim();
    if meet_name.is_empty() {
        return Err("Enter the meet’s name.".to_owned());
    }
    if meet_name.chars().count() > MAX_MEET_NAME_CHARS {
        return Err("The meet’s name must be 200 characters or fewer.".to_owned());
    }
    let start_date = start_date.trim();
    if start_date.is_empty() {
        return Err("Enter the meet’s start date.".to_owned());
    }
    if !is_iso_date(start_date) {
        return Err("Enter a valid start date.".to_owned());
    }
    let end_date = Some(end_date.trim()).filter(|date| !date.is_empty());
    if let Some(end_date) = end_date {
        if !is_iso_date(end_date) {
            return Err("Enter a valid end date, or leave it blank.".to_owned());
        }
        if end_date < start_date {
            return Err("The end date can’t be before the start date.".to_owned());
        }
    }
    if files.is_empty() {
        return Err("Add at least one schedule or start list.".to_owned());
    }
    if files.len() > MAX_FILES {
        return Err(format!("Add at most {MAX_FILES} files."));
    }
    if let Some((file, problem)) = files
        .iter()
        .find_map(|file| file_problem(file).map(|problem| (file, problem)))
    {
        let name = file.name.trim();
        return Err(if name.is_empty() {
            format!("{problem}.")
        } else {
            format!("{name}: {problem}.")
        });
    }
    Ok(CheckedSubmission {
        meet_name: meet_name.to_owned(),
        start_date: start_date.to_owned(),
        end_date: end_date.map(str::to_owned),
        file_names: files
            .iter()
            .map(|file| file.name.trim().to_owned())
            .collect(),
    })
}

/// The Content-Type a file is uploaded as: the browser's, or, when it has
/// none (some browsers give HEIC photos or CSV files none), one from the
/// file's extension.
pub fn upload_content_type(name: &str, browser_type: &str) -> String {
    let browser_type = browser_type.trim();
    if !browser_type.is_empty() {
        return browser_type.to_owned();
    }
    match file_extension(name.trim()).as_str() {
        "pdf" => "application/pdf",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "heic" => "image/heic",
        "heif" => "image/heif",
        "webp" => "image/webp",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xls" => "application/vnd.ms-excel",
        "csv" => "text/csv",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        _ => "application/octet-stream",
    }
    .to_owned()
}

/// What the page says while it uploads file `number` (from 1) of `total`.
pub fn upload_progress(number: usize, total: usize) -> String {
    format!("Uploading {number} of {total}…")
}

/// A file's size for the list: "512 B", "340 KB", "1.2 MB".
pub fn format_size(bytes: f64) -> String {
    if bytes < 1024.0 {
        format!("{} B", bytes.max(0.0).round())
    } else if bytes < 1024.0 * 1024.0 {
        format!("{} KB", (bytes / 1024.0).round())
    } else {
        format!("{:.1} MB", bytes / (1024.0 * 1024.0))
    }
}

#[component]
pub fn SubmitMeetPage() -> impl IntoView {
    let auth = expect_context::<AuthContext>();

    view! {
        <div class="access-page">
            <section class="access-card submit-card">
                {move || match auth.state.get() {
                    AuthState::Loading => {
                        view! {
                            <div class="access-status" role="status" aria-live="polite">
                                <span class="access-spinner" aria-hidden="true"></span>
                                <h1>"Checking your sign-in"</h1>
                            </div>
                        }
                            .into_any()
                    }
                    AuthState::SignedOut => {
                        view! {
                            <div class="access-heading">
                                <p class="data-eyebrow">"Submit a meet"</p>
                                <h1>"Sign in to continue"</h1>
                                <p>
                                    "Sign in to your MeetCal account to send us the schedule or start lists of a meet MeetCal doesn’t cover yet."
                                </p>
                            </div>
                            <ClerkSignIn />
                        }
                            .into_any()
                    }
                    AuthState::ConfigurationError(message) => {
                        view! {
                            <div class="access-status access-error" role="alert">
                                <h1>"Sign-in isn’t available"</h1>
                                <p>{message}</p>
                                <button class="access-button" type="button" on:click=move |_| reload()>
                                    "Try again"
                                </button>
                            </div>
                        }
                            .into_any()
                    }
                    AuthState::SignedIn(_) => view! { <SubmitMeetForm /> }.into_any(),
                }}
            </section>
        </div>
    }
}

fn reload() {
    if let Some(window) = web_sys::window() {
        let _ = window.location().reload();
    }
}

/// A file the user picked, with an id for its Remove button.
#[derive(Clone)]
struct PickedFile {
    id: u64,
    file: web_sys::File,
    info: FileInfo,
}

/// Where the form stands.
#[derive(Clone, Debug, PartialEq)]
enum Phase {
    Editing,
    /// Uploading or submitting; what it is doing, for the status line.
    Working(String),
    Sent,
}

#[component]
fn SubmitMeetForm() -> impl IntoView {
    let meet_name = RwSignal::new(String::new());
    let start_date = RwSignal::new(String::new());
    let end_date = RwSignal::new(String::new());
    let files = RwSignal::new_local(Vec::<PickedFile>::new());
    let next_id = StoredValue::new(0_u64);
    // Files already uploaded (picked file id to storage id), reused when
    // sending again after a failure (`send_submission`).
    let uploaded = StoredValue::new(HashMap::<u64, String>::new());
    let phase = RwSignal::new(Phase::Editing);
    let error = RwSignal::new(None::<String>);
    let working = Memo::new(move |_| matches!(phase.get(), Phase::Working(_)));
    let sent = Memo::new(move |_| phase.get() == Phase::Sent);

    let add_files = move |input: web_sys::HtmlInputElement| {
        if let Some(list) = input.files() {
            files.update(|files| {
                for index in 0..list.length() {
                    let Some(file) = list.get(index) else {
                        continue;
                    };
                    let id = next_id.get_value();
                    next_id.set_value(id + 1);
                    let info = FileInfo {
                        name: file.name(),
                        size: file.size(),
                    };
                    files.push(PickedFile { id, file, info });
                }
            });
        }
        // Cleared, so picking the same file again (after removing it) fires
        // another change.
        input.set_value("");
        error.set(None);
    };

    let submit = move || {
        if working.get_untracked() {
            return;
        }
        let picked = files.get_untracked();
        let infos = picked
            .iter()
            .map(|picked| picked.info.clone())
            .collect::<Vec<_>>();
        let checked = match check_submission(
            &meet_name.get_untracked(),
            &start_date.get_untracked(),
            &end_date.get_untracked(),
            &infos,
        ) {
            Ok(checked) => checked,
            Err(message) => {
                error.set(Some(message));
                return;
            }
        };
        error.set(None);
        phase.set(Phase::Working(upload_progress(1, picked.len())));
        spawn_local(async move {
            match send_submission(checked, picked, phase, uploaded).await {
                Ok(()) => {
                    uploaded.try_update_value(HashMap::clear);
                    phase.try_set(Phase::Sent);
                }
                Err(message) => {
                    error.try_set(Some(message));
                    phase.try_set(Phase::Editing);
                }
            }
        });
    };

    let reset = move || {
        meet_name.set(String::new());
        start_date.set(String::new());
        end_date.set(String::new());
        files.set(Vec::new());
        error.set(None);
        phase.set(Phase::Editing);
    };

    view! {
        <Show
            when=move || sent.get()
            fallback=move || {
                view! {
                    <div class="access-heading">
                        <p class="data-eyebrow">"Submit a meet"</p>
                        <h1>"Send us a meet"</h1>
                        <p>
                            "Have the schedule or start lists for a meet MeetCal doesn’t cover yet? Send them here and we’ll add the meet."
                        </p>
                    </div>
                    <form
                        class="submit-form"
                        novalidate=true
                        aria-busy=move || working.get().then_some("true")
                        on:submit=move |event| {
                            event.prevent_default();
                            submit();
                        }
                    >
                        <label class="submit-field">
                            <span>"Meet name"</span>
                            <input
                                class="submit-input"
                                type="text"
                                autocomplete="off"
                                placeholder="2026 Ohio State Championships"
                                disabled=move || working.get()
                                prop:value=meet_name
                                on:input=move |event| meet_name.set(event_target_value(&event))
                            />
                        </label>
                        <div class="submit-dates">
                            <label class="submit-field">
                                <span>"Start date"</span>
                                <input
                                    class="submit-input"
                                    type="date"
                                    disabled=move || working.get()
                                    prop:value=start_date
                                    on:input=move |event| start_date.set(event_target_value(&event))
                                />
                            </label>
                            <label class="submit-field">
                                <span>"End date " <small>"(optional)"</small></span>
                                <input
                                    class="submit-input"
                                    type="date"
                                    min=move || start_date.get()
                                    disabled=move || working.get()
                                    prop:value=end_date
                                    on:input=move |event| end_date.set(event_target_value(&event))
                                />
                            </label>
                        </div>
                        <div class="submit-field">
                            <span id="submit-files-label">"Schedules and start lists"</span>
                            <p id="submit-files-help" class="submit-help">
                                "PDFs, photos, spreadsheets or Word documents: up to 10 files, 20 MB each."
                            </p>
                            <input
                                id="submit-files"
                                class="submit-file-input visually-hidden"
                                type="file"
                                multiple=true
                                accept=ACCEPT
                                aria-labelledby="submit-files-label submit-files-button"
                                aria-describedby="submit-files-help"
                                disabled=move || working.get()
                                on:change=move |event| {
                                    add_files(event_target::<web_sys::HtmlInputElement>(&event))
                                }
                            />
                            <label
                                id="submit-files-button"
                                for="submit-files"
                                class="access-button access-button-secondary submit-file-button"
                                class:submit-disabled=move || working.get()
                            >
                                {move || {
                                    if files.with(Vec::is_empty) { "Choose files" } else { "Add more files" }
                                }}
                            </label>
                            <Show when=move || !files.with(Vec::is_empty)>
                                <ul class="submit-files" aria-label="Chosen files">
                                    {move || {
                                        files
                                            .get()
                                            .into_iter()
                                            .map(|picked| {
                                                let id = picked.id;
                                                let problem = file_problem(&picked.info);
                                                let name = picked.info.name.clone();
                                                view! {
                                                    <li class="submit-file" class:submit-file-invalid=problem.is_some()>
                                                        <span class="submit-file-name">{name.clone()}</span>
                                                        <span class="submit-file-size">
                                                            {format_size(picked.info.size)}
                                                        </span>
                                                        {problem
                                                            .map(|problem| {
                                                                view! {
                                                                    <span class="submit-file-problem access-inline-error">
                                                                        {problem}
                                                                    </span>
                                                                }
                                                            })}
                                                        <button
                                                            class="submit-file-remove"
                                                            type="button"
                                                            aria-label=format!("Remove {name}")
                                                            disabled=move || working.get()
                                                            on:click=move |_| {
                                                                files.update(|files| files.retain(|file| file.id != id));
                                                                error.set(None);
                                                            }
                                                        >
                                                            "Remove"
                                                        </button>
                                                    </li>
                                                }
                                            })
                                            .collect_view()
                                    }}
                                </ul>
                            </Show>
                        </div>
                        {move || {
                            error
                                .get()
                                .map(|message| {
                                    view! {
                                        <p class="access-inline-error submit-error" role="alert">
                                            {message}
                                        </p>
                                    }
                                })
                        }}
                        <p class="submit-progress" role="status" aria-live="polite">
                            {move || match phase.get() {
                                Phase::Working(progress) => progress,
                                _ => String::new(),
                            }}
                        </p>
                        <button class="access-button submit-button" type="submit" disabled=move || working.get()>
                            {move || if working.get() { "Sending…" } else { "Submit meet" }}
                        </button>
                    </form>
                }
            }
        >
            <div class="access-status link-result" role="status" aria-live="polite">
                <span class="link-result-icon" aria-hidden="true">
                    "✓"
                </span>
                <h1>"Thanks! We’ll add it soon."</h1>
                <p>"We got the meet and its files."</p>
                <button class="access-button" type="button" on:click=move |_| reset()>
                    "Send another meet"
                </button>
            </div>
        </Show>
    }
}

/// Uploads each file in turn, then submits the meet. The error is the one to
/// show; the form keeps what the user entered.
///
/// `uploaded` holds the storage id of each picked file already uploaded, for
/// as long as the form lives: a retry after a failure reuses them instead of
/// uploading again, so retries on a poor connection do not use up the day's
/// uploads. A retry refused because its files are already in a submission
/// found the earlier attempt's submit stored after all (only this form had
/// those ids), so it counts as sent.
async fn send_submission(
    checked: CheckedSubmission,
    picked: Vec<PickedFile>,
    phase: RwSignal<Phase>,
    uploaded: StoredValue<HashMap<u64, String>>,
) -> Result<(), String> {
    let total = picked.len();
    let mut files = Vec::with_capacity(total);
    let mut reused = false;
    for (index, (picked, name)) in picked.into_iter().zip(checked.file_names).enumerate() {
        phase.try_set(Phase::Working(upload_progress(index + 1, total)));
        if let Some(storage_id) = uploaded.with_value(|uploaded| uploaded.get(&picked.id).cloned())
        {
            reused = true;
            files.push(MeetSubmissionFile { storage_id, name });
            continue;
        }
        let upload_url = api::meet_submission_upload_url()
            .await
            .map_err(|error| error.to_string())?;
        let buffer = JsFuture::from(picked.file.array_buffer())
            .await
            .map_err(|_| format!("{name} couldn’t be read. Choose it again and retry."))?;
        let bytes = js_sys::Uint8Array::new(&buffer).to_vec();
        let content_type = upload_content_type(&name, &picked.file.type_());
        let storage_id = api::upload_meet_submission_file(&upload_url, &content_type, bytes)
            .await
            .map_err(|error| format!("{name} couldn’t be uploaded. {error}"))?;
        uploaded.update_value(|uploaded| {
            uploaded.insert(picked.id, storage_id.clone());
        });
        files.push(MeetSubmissionFile { storage_id, name });
    }
    phase.try_set(Phase::Working("Sending the meet…".to_owned()));
    let submission = MeetSubmission {
        meet_name: checked.meet_name,
        start_date: checked.start_date,
        end_date: checked.end_date,
        contact_email: crate::auth::primary_email(),
        files,
    };
    match api::submit_meet(&submission).await {
        Ok(()) => Ok(()),
        Err(error) if stored_on_an_earlier_try(reused, &error.to_string()) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

/// Whether a refused submit means an earlier attempt stored the meet after
/// all: the server refuses files already in a submission, and only this
/// form had the ids it reused.
fn stored_on_an_earlier_try(reused: bool, message: &str) -> bool {
    reused && message.starts_with("File already submitted")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str, size: f64) -> FileInfo {
        FileInfo {
            name: name.to_owned(),
            size,
        }
    }

    fn check(
        name: &str,
        start: &str,
        end: &str,
        files: &[FileInfo],
    ) -> Result<CheckedSubmission, String> {
        check_submission(name, start, end, files)
    }

    #[test]
    fn only_a_retry_counts_already_submitted_as_sent() {
        assert!(stored_on_an_earlier_try(
            true,
            "File already submitted: a.pdf"
        ));
        assert!(!stored_on_an_earlier_try(
            false,
            "File already submitted: a.pdf"
        ));
        assert!(!stored_on_an_earlier_try(true, "Meet name is required"));
    }

    #[test]
    fn the_picker_accepts_exactly_the_servers_extensions() {
        let accept = FILE_EXTENSIONS
            .iter()
            .map(|extension| format!(".{extension}"))
            .collect::<Vec<_>>()
            .join(",");
        assert_eq!(ACCEPT, accept);
        // `convex/lib/meetSubmissions.ts` is the source of truth.
        let server = include_str!("../../../convex/lib/meetSubmissions.ts");
        let listed = FILE_EXTENSIONS
            .iter()
            .map(|extension| format!("'{extension}'"))
            .collect::<Vec<_>>()
            .join(", ");
        assert!(
            server.contains(&format!("MEET_SUBMISSION_FILE_EXTENSIONS = [{listed}]")),
            "FILE_EXTENSIONS differs from the server's"
        );
    }

    #[test]
    fn extensions_are_read_as_the_server_reads_them() {
        assert_eq!(file_extension("schedule.PDF"), "pdf");
        assert_eq!(file_extension("start.list.xlsx"), "xlsx");
        assert_eq!(file_extension("noextension"), "");
        assert_eq!(file_extension(".pdf"), "");
        assert_eq!(file_extension("trailing."), "");
        assert_eq!(file_extension("photo.HeIc"), "heic");
    }

    #[test]
    fn a_valid_submission_comes_back_trimmed() {
        let checked = check(
            "  Ohio Open  ",
            "2026-11-14",
            " 2026-11-15 ",
            &[
                file(" schedule.pdf ", 1000.0),
                file("start list.XLSX", MAX_FILE_BYTES),
            ],
        )
        .unwrap();
        assert_eq!(
            checked,
            CheckedSubmission {
                meet_name: "Ohio Open".to_owned(),
                start_date: "2026-11-14".to_owned(),
                end_date: Some("2026-11-15".to_owned()),
                file_names: vec!["schedule.pdf".to_owned(), "start list.XLSX".to_owned()],
            }
        );
    }

    #[test]
    fn the_end_date_is_optional_and_may_equal_the_start() {
        let files = [file("a.pdf", 1.0)];
        assert_eq!(
            check("Meet", "2026-11-14", "", &files).unwrap().end_date,
            None
        );
        assert_eq!(
            check("Meet", "2026-11-14", "  ", &files).unwrap().end_date,
            None
        );
        assert_eq!(
            check("Meet", "2026-11-14", "2026-11-14", &files)
                .unwrap()
                .end_date,
            Some("2026-11-14".to_owned())
        );
    }

    #[test]
    fn the_meet_name_is_required_and_at_most_200_characters() {
        let files = [file("a.pdf", 1.0)];
        assert_eq!(
            check("   ", "2026-11-14", "", &files).unwrap_err(),
            "Enter the meet’s name."
        );
        // Characters, not bytes: 200 accented letters are fine.
        assert!(check(&"é".repeat(200), "2026-11-14", "", &files).is_ok());
        assert_eq!(
            check(&"x".repeat(201), "2026-11-14", "", &files).unwrap_err(),
            "The meet’s name must be 200 characters or fewer."
        );
    }

    #[test]
    fn dates_must_be_real_and_in_order() {
        let files = [file("a.pdf", 1.0)];
        assert_eq!(
            check("Meet", "", "", &files).unwrap_err(),
            "Enter the meet’s start date."
        );
        for bad in [
            "2026-02-30",
            "2026-13-01",
            "2026-1-01",
            "26-01-01",
            "2026/01/01",
            "2026-00-10",
        ] {
            assert_eq!(
                check("Meet", bad, "", &files).unwrap_err(),
                "Enter a valid start date.",
                "{bad}"
            );
            assert_eq!(
                check("Meet", "2026-01-01", bad, &files).unwrap_err(),
                "Enter a valid end date, or leave it blank.",
                "{bad}"
            );
        }
        assert_eq!(
            check("Meet", "2026-11-15", "2026-11-14", &files).unwrap_err(),
            "The end date can’t be before the start date."
        );
    }

    #[test]
    fn leap_days_are_dates_only_in_leap_years() {
        assert!(is_iso_date("2028-02-29"));
        assert!(is_iso_date("2000-02-29"));
        assert!(!is_iso_date("2026-02-29"));
        assert!(!is_iso_date("1900-02-29"));
        assert!(is_iso_date("2026-12-31"));
        assert!(!is_iso_date("2026-04-31"));
        assert!(!is_iso_date("２０２６-01-01"));
        assert!(!is_iso_date("+026-01-01"));
    }

    #[test]
    fn one_to_ten_files_may_be_sent() {
        assert_eq!(
            check("Meet", "2026-11-14", "", &[]).unwrap_err(),
            "Add at least one schedule or start list."
        );
        let ten = vec![file("a.pdf", 1.0); MAX_FILES];
        assert!(check("Meet", "2026-11-14", "", &ten).is_ok());
        let eleven = vec![file("a.pdf", 1.0); MAX_FILES + 1];
        assert_eq!(
            check("Meet", "2026-11-14", "", &eleven).unwrap_err(),
            "Add at most 10 files."
        );
    }

    #[test]
    fn each_file_must_be_an_accepted_type_size_and_name() {
        assert_eq!(file_problem(&file("schedule.pdf", 1.0)), None);
        assert_eq!(file_problem(&file("photo.JPEG", MAX_FILE_BYTES)), None);
        assert_eq!(
            file_problem(&file("photo.jpg", MAX_FILE_BYTES + 1.0)),
            Some("Each file must be 20 MB or smaller")
        );
        assert_eq!(
            file_problem(&file("results.zip", 1.0)),
            Some("Only PDFs, photos, spreadsheets and Word documents can be sent")
        );
        assert_eq!(file_problem(&file("  ", 1.0)), Some("The file has no name"));
        let long = format!("{}.pdf", "x".repeat(MAX_FILE_NAME_CHARS - 3));
        assert_eq!(
            file_problem(&file(&long, 1.0)),
            Some("File names must be 200 characters or fewer")
        );
        assert_eq!(file_problem(&file(&long[1..], 1.0)), None);

        // The first file with a problem is named in the form's error.
        assert_eq!(
            check(
                "Meet",
                "2026-11-14",
                "",
                &[file("a.pdf", 1.0), file("b.zip", 1.0)]
            )
            .unwrap_err(),
            "b.zip: Only PDFs, photos, spreadsheets and Word documents can be sent."
        );
        assert_eq!(
            check(
                "Meet",
                "2026-11-14",
                "",
                &[file("big.pdf", 30.0 * 1024.0 * 1024.0)]
            )
            .unwrap_err(),
            "big.pdf: Each file must be 20 MB or smaller."
        );
    }

    #[test]
    fn files_without_a_browser_type_are_typed_by_extension() {
        assert_eq!(
            upload_content_type("a.pdf", "application/pdf"),
            "application/pdf"
        );
        assert_eq!(upload_content_type("photo.HEIC", ""), "image/heic");
        assert_eq!(upload_content_type("list.csv", " "), "text/csv");
        assert_eq!(
            upload_content_type("start.xlsx", ""),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        assert_eq!(upload_content_type("odd", ""), "application/octet-stream");
        for extension in FILE_EXTENSIONS {
            assert_ne!(
                upload_content_type(&format!("file.{extension}"), ""),
                "application/octet-stream",
                "{extension}"
            );
        }
    }

    #[test]
    fn progress_counts_files_from_one() {
        assert_eq!(upload_progress(1, 1), "Uploading 1 of 1…");
        assert_eq!(upload_progress(2, 5), "Uploading 2 of 5…");
    }

    #[test]
    fn sizes_read_in_the_largest_whole_unit() {
        assert_eq!(format_size(512.0), "512 B");
        assert_eq!(format_size(340.0 * 1024.0), "340 KB");
        assert_eq!(format_size(1.25 * 1024.0 * 1024.0), "1.2 MB");
        assert_eq!(format_size(MAX_FILE_BYTES), "20.0 MB");
    }
}
