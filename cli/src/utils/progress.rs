//! A progress counter on stderr for the long reads (`Reading results… 12000`), shown only when
//! stderr is a terminal.

use std::io::{IsTerminal, Write};

/// Clears the line on a terminal.
const CLEAR_LINE: &str = "\r\x1b[2K";

/// A counter rewritten in place on one line. Dropping it clears the line, however the read
/// ends: an error returned with `?` then prints on a clean line, not glued to the counter.
pub struct Progress {
    label: &'static str,
    out: Option<Box<dyn Write>>,
    written: bool,
}

impl Progress {
    /// A counter on stderr, or one that prints nothing when stderr is not a terminal (piped,
    /// redirected, or a script's).
    pub fn new(label: &'static str) -> Self {
        let out: Option<Box<dyn Write>> = std::io::stderr()
            .is_terminal()
            .then(|| Box::new(std::io::stderr()) as Box<dyn Write>);
        Self::to(label, out)
    }

    /// A counter writing to `out` (`None` prints nothing).
    pub fn to(label: &'static str, out: Option<Box<dyn Write>>) -> Self {
        Self {
            label,
            out,
            written: false,
        }
    }

    /// Shows `label… status` in place of the last status.
    pub fn update(&mut self, status: impl std::fmt::Display) {
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

#[cfg(test)]
mod tests {
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
