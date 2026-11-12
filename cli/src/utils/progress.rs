//! A progress counter on stderr for the long reads (`Reading results… 12000`), shown only when
//! stderr is a terminal.

use std::io::{IsTerminal, Write};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::Duration;

/// Clears the line on a terminal.
const CLEAR_LINE: &str = "\r\x1b[2K";

/// A counter rewritten in place on one line. Dropping it clears the line, however the read
/// ends: an error returned with `?` then prints on a clean line, not glued to the counter.
pub(crate) struct Progress {
    label: &'static str,
    out: Option<Box<dyn Write>>,
    written: bool,
}

impl Progress {
    /// A counter on stderr, or one that prints nothing when stderr is not a terminal (piped,
    /// redirected, or a script's).
    pub(crate) fn new(label: &'static str) -> Self {
        let out: Option<Box<dyn Write>> = std::io::stderr()
            .is_terminal()
            .then(|| Box::new(std::io::stderr()) as Box<dyn Write>);
        Self::to(label, out)
    }

    /// A counter writing to `out` (`None` prints nothing).
    pub(crate) fn to(label: &'static str, out: Option<Box<dyn Write>>) -> Self {
        Self {
            label,
            out,
            written: false,
        }
    }

    pub(crate) fn update(&mut self, status: impl std::fmt::Display) {
        stop_waiting_line();
        if let Some(out) = self.out.as_mut() {
            let _ = write!(out, "\r{}… {status}", self.label);
            let _ = out.flush();
            self.written = true;
        }
    }
}

impl Drop for Progress {
    fn drop(&mut self) {
        if let (Some(out), true) = (self.out.as_mut(), self.written) {
            let _ = write!(out, "{CLEAR_LINE}");
            let _ = out.flush();
        }
    }
}

pub(crate) const WAITING_DELAY: Duration = Duration::from_secs(1);

pub(crate) const WAITING_LABEL: &str = "Fetching from MeetCal…";

const WAITING_FRAME_INTERVAL: Duration = Duration::from_millis(100);

const WAITING_FRAMES: [char; 10] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

struct Waiting {
    out: Box<dyn Write + Send>,
    shown: bool,
}

#[derive(Clone, Default)]
struct WaitingLine {
    state: Arc<Mutex<Option<Waiting>>>,
}

impl WaitingLine {
    fn lock(&self) -> MutexGuard<'_, Option<Waiting>> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn start(&self, out: Box<dyn Write + Send>, delay: Duration) {
        *self.lock() = Some(Waiting { out, shown: false });
        let line = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(delay).await;
            for frame in WAITING_FRAMES.iter().cycle() {
                if !line.draw(*frame) {
                    break;
                }
                tokio::time::sleep(WAITING_FRAME_INTERVAL).await;
            }
        });
    }

    fn draw(&self, frame: char) -> bool {
        let mut state = self.lock();
        let Some(waiting) = state.as_mut() else {
            return false;
        };
        let _ = write!(waiting.out, "\r{frame} {WAITING_LABEL}");
        let _ = waiting.out.flush();
        waiting.shown = true;
        true
    }

    fn stop(&self) {
        if let Some(mut waiting) = self.lock().take()
            && waiting.shown
        {
            let _ = write!(waiting.out, "{CLEAR_LINE}");
            let _ = waiting.out.flush();
        }
    }
}

fn waiting_line() -> &'static WaitingLine {
    static LINE: OnceLock<WaitingLine> = OnceLock::new();
    LINE.get_or_init(WaitingLine::default)
}

pub fn start_waiting_line() {
    if std::io::stderr().is_terminal() {
        waiting_line().start(Box::new(std::io::stderr()), WAITING_DELAY);
    }
}

pub fn stop_waiting_line() {
    waiting_line().stop();
}

pub(crate) fn note(line: impl std::fmt::Display) {
    stop_waiting_line();
    eprintln!("{line}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone, Default)]
    struct Shared(Arc<Mutex<Vec<u8>>>);

    impl Write for Shared {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn failing_read(progress: &mut Progress) -> anyhow::Result<()> {
        progress.update(2000);
        anyhow::bail!("page two failed")
    }

    #[test]
    fn an_early_error_leaves_a_clean_line() {
        let out = Shared::default();
        let result = {
            let mut progress = Progress::to("Reading results", Some(Box::new(out.clone())));
            failing_read(&mut progress)
        };
        assert!(result.is_err());
        let written = String::from_utf8(out.0.lock().unwrap().clone()).unwrap();
        assert_eq!(written, "\rReading results… 2000\r\x1b[2K");
    }

    #[test]
    fn nothing_is_written_without_a_terminal_or_an_update() {
        let out = Shared::default();
        drop(Progress::to("Reading results", Some(Box::new(out.clone()))));
        assert!(out.0.lock().unwrap().is_empty());
        let mut silent = Progress::to("Reading results", None);
        silent.update(1);
    }
}

#[cfg(test)]
mod waiting_tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Default)]
    struct Shared(Arc<Mutex<Vec<u8>>>);

    impl Write for Shared {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl Shared {
        fn text(&self) -> String {
            String::from_utf8(self.0.lock().unwrap().clone()).unwrap()
        }
    }

    #[tokio::test]
    async fn a_slow_command_shows_the_waiting_line_and_clears_it_before_output() {
        let out = Shared::default();
        let line = WaitingLine::default();
        line.start(Box::new(out.clone()), Duration::from_millis(20));
        tokio::time::sleep(Duration::from_millis(400)).await;
        line.stop();
        let written = out.text();
        assert!(
            written.starts_with(&format!("\r⠋ {WAITING_LABEL}")),
            "{written:?}"
        );
        assert!(written.ends_with(CLEAR_LINE), "{written:?}");
        tokio::time::sleep(Duration::from_millis(250)).await;
        assert_eq!(out.text(), written);
    }

    #[tokio::test]
    async fn a_command_that_answers_within_the_delay_shows_nothing() {
        let out = Shared::default();
        let line = WaitingLine::default();
        line.start(Box::new(out.clone()), Duration::from_millis(200));
        line.stop();
        tokio::time::sleep(Duration::from_millis(350)).await;
        line.stop();
        assert_eq!(out.text(), "");
    }
}
