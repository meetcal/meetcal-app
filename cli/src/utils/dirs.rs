use std::ffi::OsString;
use std::fs;
use std::io::{Error, ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Flush {
    ToDisk,
    WhenTheSystemDoes,
}

pub(crate) fn user_dir(
    xdg_dir: Option<OsString>,
    home: Option<OsString>,
    windows_dir: Option<OsString>,
    home_subdir: &str,
) -> Option<PathBuf> {
    let absolute =
        |value: Option<OsString>| value.map(PathBuf::from).filter(|path| path.is_absolute());
    if let Some(dir) = absolute(xdg_dir) {
        return Some(dir);
    }
    if cfg!(windows)
        && let Some(dir) = absolute(windows_dir)
    {
        return Some(dir);
    }
    absolute(home).map(|home| home.join(home_subdir))
}

#[cfg(unix)]
pub(crate) fn create_private_dir(dir: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)
}

#[cfg(not(unix))]
pub(crate) fn create_private_dir(dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dir)
}

static TEMPORARY_FILES: AtomicU64 = AtomicU64::new(0);

pub(crate) fn replace_private_file(
    path: &Path,
    contents: &[u8],
    flush: Flush,
) -> std::io::Result<()> {
    let (Some(dir), Some(name)) = (path.parent(), path.file_name()) else {
        return Err(Error::new(
            ErrorKind::InvalidInput,
            format!("{} names no file in a directory", path.display()),
        ));
    };
    let temporary = dir.join(format!(
        ".{}.{}.{}.tmp",
        name.to_string_lossy(),
        std::process::id(),
        TEMPORARY_FILES.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = fs::remove_file(&temporary);
    let written =
        write_private_file(&temporary, contents, flush).and_then(|()| fs::rename(&temporary, path));
    if written.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    written
}

fn write_private_file(path: &Path, contents: &[u8], flush: Flush) -> std::io::Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(contents)?;
    match flush {
        Flush::ToDisk => file.sync_all(),
        Flush::WhenTheSystemDoes => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_user_dir_follows_xdg_then_home() {
        let os = |value: &str| Some(OsString::from(value));
        assert_eq!(
            user_dir(os("/xdg"), os("/home/u"), None, ".cache"),
            Some(PathBuf::from("/xdg"))
        );
        for xdg in [os("relative/dir"), os(""), None] {
            assert_eq!(
                user_dir(xdg, os("/home/u"), None, ".cache"),
                Some(PathBuf::from("/home/u/.cache"))
            );
        }
        if !cfg!(windows) {
            assert_eq!(user_dir(None, None, os("/appdata"), ".cache"), None);
        }
    }

    #[test]
    fn a_replaced_file_leaves_no_temporary_file_behind() {
        let dir = std::env::temp_dir().join(format!("meetcal-dirs-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        create_private_dir(&dir).unwrap();
        let path = dir.join("answer.json");
        replace_private_file(&path, b"first", Flush::WhenTheSystemDoes).unwrap();
        replace_private_file(&path, b"second", Flush::ToDisk).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "second");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = |path: &Path| fs::metadata(path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode(&path), 0o600);
            assert_eq!(mode(&dir), 0o700);
        }
        fs::remove_dir_all(dir).unwrap();
    }
}
