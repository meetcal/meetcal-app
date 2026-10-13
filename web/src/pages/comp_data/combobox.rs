//! A search field with a suggestion list, following the WAI-ARIA combobox
//! pattern (<https://www.w3.org/WAI/ARIA/apg/patterns/combobox/>): the input
//! keeps focus, Up and Down move through the suggestions, Enter picks the
//! highlighted one (or submits the form when none is), and Escape closes the
//! list. The athlete and meet searches both use it (#212).

use leptos::ev::KeyboardEvent;
use leptos::prelude::*;

/// What the suggestion list has to show.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Suggestions {
    /// Nothing to suggest yet (the input is too short); the list is closed.
    Idle,
    Searching,
    Ready(Vec<String>),
    Failed,
}

/// The words the combobox uses for its suggestions.
#[derive(Clone, Copy)]
pub(crate) struct SuggestionCopy {
    /// The listbox's accessible name, such as "Athlete suggestions".
    pub list_label: &'static str,
    /// Shown when a search found nothing, such as "No matching athletes".
    pub no_matches: &'static str,
    /// Shown when the suggestions couldn't load.
    pub failed: &'static str,
}

/// A key the combobox acts on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Key {
    Down,
    Up,
    Enter,
    Escape,
}

impl Key {
    fn parse(key: &str) -> Option<Self> {
        match key {
            "ArrowDown" => Some(Self::Down),
            "ArrowUp" => Some(Self::Up),
            "Enter" => Some(Self::Enter),
            "Escape" => Some(Self::Escape),
            _ => None,
        }
    }
}

/// The highlighted option after `key`, out of `count` options. Up and Down
/// wrap around; with nothing highlighted, Down starts at the first option and
/// Up at the last.
fn next_active(active: Option<usize>, count: usize, key: Key) -> Option<usize> {
    if count == 0 {
        return None;
    }
    match (key, active) {
        (Key::Down, None) => Some(0),
        (Key::Down, Some(index)) => Some((index + 1) % count),
        (Key::Up, None | Some(0)) => Some(count - 1),
        (Key::Up, Some(index)) => Some(index - 1),
        (Key::Enter | Key::Escape, _) => active,
    }
}

/// The live-region announcement for `suggestions`.
fn announcement(suggestions: &Suggestions, copy: SuggestionCopy) -> String {
    match suggestions {
        Suggestions::Idle => String::new(),
        Suggestions::Searching => "Searching…".to_owned(),
        Suggestions::Ready(options) if options.is_empty() => copy.no_matches.to_owned(),
        Suggestions::Ready(options) if options.len() == 1 => {
            "1 suggestion. Use the down arrow to choose it.".to_owned()
        }
        Suggestions::Ready(options) => format!(
            "{} suggestions. Use the up and down arrows to choose one.",
            options.len()
        ),
        Suggestions::Failed => copy.failed.to_owned(),
    }
}

#[component]
pub(crate) fn Combobox(
    input_id: &'static str,
    label: &'static str,
    placeholder: &'static str,
    #[prop(into)] input_class: String,
    #[prop(into)] wrapper_class: String,
    /// The class of the dropdown under the input.
    list_class: &'static str,
    #[prop(default = false)] required: bool,
    #[prop(into)] value: Signal<String>,
    #[prop(into)] suggestions: Signal<Suggestions>,
    copy: SuggestionCopy,
    /// Called with the input's text after every edit.
    #[prop(into)]
    on_input: Callback<String>,
    /// Called with the suggestion the user picked.
    #[prop(into)]
    on_select: Callback<String>,
    /// Called when the list closes without a pick (Escape, Enter, or focus
    /// leaving the field). An owner that searches should stop any pending
    /// search here, so a late answer can't reopen the list.
    #[prop(into)]
    on_dismiss: Callback<()>,
) -> impl IntoView {
    let listbox_id = format!("{input_id}-suggestions");
    let option_id = move |index: usize| format!("{input_id}-option-{index}");
    let (open, set_open) = signal(false);
    let (active, set_active) = signal(None::<usize>);

    let options = move || {
        suggestions.with(|state| match state {
            Suggestions::Ready(options) => options.clone(),
            _ => Vec::new(),
        })
    };
    let popup_shown = move || open.get() && suggestions.with(|state| *state != Suggestions::Idle);
    let list_shown = move || popup_shown() && !options().is_empty();

    // A new answer starts with nothing highlighted.
    Effect::new(move |_| {
        suggestions.track();
        set_active.set(None);
    });

    let close = move || {
        set_open.set(false);
        set_active.set(None);
    };
    let dismiss = move || {
        if open.get_untracked() {
            close();
        }
        on_dismiss.run(());
    };
    let select = move |option: String| {
        close();
        on_select.run(option);
    };

    let on_keydown = move |event: KeyboardEvent| {
        let Some(key) = Key::parse(&event.key()) else {
            return;
        };
        let options = options();
        match key {
            Key::Down | Key::Up => {
                event.prevent_default();
                set_open.set(true);
                if popup_shown() {
                    set_active.set(next_active(active.get_untracked(), options.len(), key));
                }
            }
            Key::Enter => {
                let picked = list_shown()
                    .then(|| active.get_untracked())
                    .flatten()
                    .and_then(|index| options.get(index).cloned());
                match picked {
                    Some(option) => {
                        event.prevent_default();
                        select(option);
                    }
                    // Nothing highlighted: the form submits as usual.
                    None => dismiss(),
                }
            }
            Key::Escape => {
                if popup_shown() {
                    event.prevent_default();
                }
                dismiss();
            }
        }
    };

    view! {
        <div class=wrapper_class>
            <label for=input_id>{label}</label>
            <input
                id=input_id
                class=input_class
                type="search"
                role="combobox"
                required=required
                autocomplete="off"
                aria-autocomplete="list"
                aria-controls=listbox_id.clone()
                aria-expanded=move || if list_shown() { "true" } else { "false" }
                aria-activedescendant=move || {
                    list_shown().then(|| active.get().map(option_id)).flatten()
                }
                placeholder=placeholder
                prop:value=move || value.get()
                on:input=move |event| {
                    set_open.set(true);
                    on_input.run(event_target_value(&event));
                }
                on:keydown=on_keydown
                on:blur=move |_| dismiss()
            />
            <div class=list_class hidden=move || !popup_shown()>
                {move || {
                    suggestions.with(|state| match state {
                        Suggestions::Searching => Some("Searching…"),
                        Suggestions::Ready(options) if options.is_empty() => Some(copy.no_matches),
                        Suggestions::Failed => Some(copy.failed),
                        _ => None,
                    })
                    .map(|message| view! { <p>{message}</p> })
                }}
                <ul id=listbox_id role="listbox" aria-label=copy.list_label hidden=move || !list_shown()>
                    {move || {
                        options()
                            .into_iter()
                            .enumerate()
                            .map(|(index, option)| {
                                let picked = option.clone();
                                view! {
                                    <li
                                        id=option_id(index)
                                        role="option"
                                        aria-selected=move || {
                                            if active.get() == Some(index) { "true" } else { "false" }
                                        }
                                        // Keep focus in the input, so picking doesn't blur it.
                                        on:mousedown=|event| event.prevent_default()
                                        on:click=move |_| select(picked.clone())
                                    >
                                        {option}
                                    </li>
                                }
                            })
                            .collect_view()
                    }}
                </ul>
            </div>
            <p class="visually-hidden" role="status">
                {move || if open.get() { suggestions.with(|state| announcement(state, copy)) } else { String::new() }}
            </p>
        </div>
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const COPY: SuggestionCopy = SuggestionCopy {
        list_label: "Athlete suggestions",
        no_matches: "No matching athletes",
        failed: "Couldn’t load athlete suggestions",
    };

    #[test]
    fn down_starts_at_the_first_option_and_wraps() {
        assert_eq!(next_active(None, 3, Key::Down), Some(0));
        assert_eq!(next_active(Some(0), 3, Key::Down), Some(1));
        assert_eq!(next_active(Some(2), 3, Key::Down), Some(0));
    }

    #[test]
    fn up_starts_at_the_last_option_and_wraps() {
        assert_eq!(next_active(None, 3, Key::Up), Some(2));
        assert_eq!(next_active(Some(0), 3, Key::Up), Some(2));
        assert_eq!(next_active(Some(2), 3, Key::Up), Some(1));
    }

    #[test]
    fn no_options_means_nothing_to_highlight() {
        for key in [Key::Down, Key::Up, Key::Enter, Key::Escape] {
            assert_eq!(next_active(Some(1), 0, key), None);
        }
    }

    #[test]
    fn only_navigation_keys_are_handled() {
        assert_eq!(Key::parse("ArrowDown"), Some(Key::Down));
        assert_eq!(Key::parse("Escape"), Some(Key::Escape));
        assert_eq!(Key::parse("a"), None);
        assert_eq!(Key::parse("Tab"), None);
    }

    #[test]
    fn announcements_say_what_the_list_holds() {
        assert_eq!(announcement(&Suggestions::Idle, COPY), "");
        assert_eq!(announcement(&Suggestions::Searching, COPY), "Searching…");
        assert_eq!(
            announcement(&Suggestions::Ready(Vec::new()), COPY),
            "No matching athletes"
        );
        assert_eq!(
            announcement(&Suggestions::Ready(vec!["A".into(), "B".into()]), COPY),
            "2 suggestions. Use the up and down arrows to choose one."
        );
        assert_eq!(
            announcement(&Suggestions::Failed, COPY),
            "Couldn’t load athlete suggestions"
        );
    }
}
