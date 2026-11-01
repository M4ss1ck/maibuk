//! The color the desktop window paints before the page does.
//!
//! The main window is created hidden (`visible: false` in `tauri.conf.json`)
//! and shown from `setup`, but a WebView paints white until its first frame
//! arrives. Rust cannot read the webview's localStorage, where the theme
//! lives, so the frontend reports the resolved `--color-background` through
//! `set_window_background` and this module keeps it beside the rest of the
//! app's own data, read in `setup` before `show()`. Desktop only: Android
//! keeps its current launch behavior.

use std::{ffi::OsString, path::Path};

use tauri::window::Color;

/// A single `#rrggbb` string in the app data directory.
const FILE_NAME: &str = "window-background";

/// `--color-background` in `src/index.css`: light `@theme`, dark `.dark`.
const LIGHT: Color = Color(250, 250, 249, 255);
const DARK: Color = Color(28, 25, 23, 255);

pub const INVALID: &str = "WINDOW_BACKGROUND_INVALID";

/// An exactly six-digit `#rrggbb` string, trimmed; anything else is not a color
/// this module records.
pub fn parse_hex(s: &str) -> Option<Color> {
    let digits = s.trim().strip_prefix('#')?;
    if digits.len() != 6 || !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let channel = |start: usize| u8::from_str_radix(&digits[start..start + 2], 16).ok();
    Some(Color(channel(0)?, channel(2)?, channel(4)?, 255))
}

/// The persisted color, or `None` when the file is missing or corrupt.
pub fn read_background(dir: &Path) -> Option<Color> {
    let text = std::fs::read_to_string(dir.join(FILE_NAME)).ok()?;
    parse_hex(&text)
}

/// What the first frame uses before the frontend has reported anything.
pub fn default_background(dark: bool) -> Color {
    if dark {
        DARK
    } else {
        LIGHT
    }
}

/// Persist `color` for the next launch. A half-written file would be worse than
/// the old one, so the write lands on a temp path first.
fn write_background(dir: &Path, color: Color) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    let text = format!("#{:02x}{:02x}{:02x}", color.0, color.1, color.2);
    let temp = dir.join(format!("{FILE_NAME}.tmp"));
    std::fs::write(&temp, text).map_err(|error| error.to_string())?;
    std::fs::rename(&temp, dir.join(FILE_NAME)).map_err(|error| error.to_string())
}

/// Record the background the page paints and apply it to the open window so a
/// theme switch does not flash the old color either.
#[tauri::command]
pub fn set_window_background(app: tauri::AppHandle, color: String) -> Result<(), String> {
    use tauri::Manager;

    let parsed = parse_hex(&color).ok_or_else(|| INVALID.to_string())?;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    write_background(&dir, parsed)?;

    // The window can be gone (closed to the tray) while a theme change lands.
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_background_color(Some(parsed));
    }
    Ok(())
}

/// How long the main window waits for its page before showing anyway, so a
/// stalled load still gets a window.
pub const REVEAL_FALLBACK: std::time::Duration = std::time::Duration::from_secs(3);

/// The flag an autostart/login launch passes; that launch stays in the tray.
pub const MINIMIZED_ARG: &str = "--minimized";

/// The arguments a restart launches with: this launch's, without
/// MINIMIZED_ARG. Restart now is a click in the window, so the author expects
/// the window back even when this launch came from autostart.
pub fn shown_args(args: Vec<OsString>) -> Vec<OsString> {
    args.into_iter()
        .filter(|arg| arg != MINIMIZED_ARG)
        .collect()
}

static REVEALED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Show the main window the first time this is called, unless this is an
/// autostart/login launch (--minimized), whose first show comes from the tray.
/// WebKitGTK paints a new WebView white until its web process delivers a frame,
/// whatever background color it was given (#624), so the window is shown once
/// the page has loaded (or after REVEAL_FALLBACK), never at creation.
pub fn reveal_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;

    let minimized = std::env::args().any(|arg| arg == MINIMIZED_ARG);
    reveal_once(&REVEALED, minimized, || {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.show();
        }
    });
}

/// Runs `show` on the first call only, and never for a minimized launch.
fn reveal_once(revealed: &std::sync::atomic::AtomicBool, minimized: bool, show: impl FnOnce()) {
    if revealed.swap(true, std::sync::atomic::Ordering::SeqCst) || minimized {
        return;
    }
    show();
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    #[test]
    fn reveal_shows_once_whichever_of_page_load_and_fallback_comes_first() {
        let revealed = std::sync::atomic::AtomicBool::new(false);
        let mut shows = 0;
        reveal_once(&revealed, false, || shows += 1);
        reveal_once(&revealed, false, || shows += 1);
        assert_eq!(shows, 1);
    }

    #[test]
    fn reveal_never_shows_a_minimized_launch() {
        let revealed = std::sync::atomic::AtomicBool::new(false);
        let mut shows = 0;
        reveal_once(&revealed, true, || shows += 1);
        reveal_once(&revealed, true, || shows += 1);
        assert_eq!(shows, 0);
    }

    #[test]
    fn a_restart_of_an_autostart_launch_comes_back_shown() {
        let args = ["/usr/bin/maibuk", MINIMIZED_ARG]
            .map(OsString::from)
            .to_vec();
        assert_eq!(shown_args(args), vec![OsString::from("/usr/bin/maibuk")]);
    }

    #[test]
    fn a_restart_keeps_every_other_argument_in_order() {
        let args = ["/usr/bin/maibuk", "maibuk://open", MINIMIZED_ARG, "--flag"]
            .map(OsString::from)
            .to_vec();
        let expected = ["/usr/bin/maibuk", "maibuk://open", "--flag"]
            .map(OsString::from)
            .to_vec();
        assert_eq!(shown_args(args), expected);
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "maibuk-window-background-test-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn parses_six_digit_hex() {
        assert_eq!(parse_hex("#fafaf9"), Some(Color(250, 250, 249, 255)));
        assert_eq!(parse_hex("#1C1917"), Some(Color(28, 25, 23, 255)));
        assert_eq!(parse_hex("  #000000  "), Some(Color(0, 0, 0, 255)));
    }

    #[test]
    fn rejects_anything_but_six_digit_hex() {
        for value in [
            "",
            "fafaf9",
            "#fff",
            "#fafaf9f",
            "#fafaf9ff",
            "#gggggg",
            "rgb(250, 250, 249)",
            "#fafaf9;",
            " #faf af9",
        ] {
            assert_eq!(parse_hex(value), None, "{value:?}");
        }
    }

    #[test]
    fn reads_a_persisted_background() {
        let dir = temp_dir("read");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(FILE_NAME), "#1c1917\n").unwrap();

        assert_eq!(read_background(&dir), Some(Color(28, 25, 23, 255)));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_missing_directory_or_file_reads_as_none() {
        let dir = temp_dir("missing");
        assert_eq!(read_background(&dir), None);

        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(read_background(&dir), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn invalid_content_reads_as_none() {
        let dir = temp_dir("invalid");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(FILE_NAME), "white").unwrap();

        assert_eq!(read_background(&dir), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn writes_what_it_reads() {
        let dir = temp_dir("write");
        let color = Color(1, 2, 3, 255);

        write_background(&dir, color).unwrap();

        assert_eq!(read_background(&dir), Some(color));
        assert!(!dir.join(format!("{FILE_NAME}.tmp")).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn defaults_are_the_documented_values() {
        assert_eq!(default_background(false), Color(250, 250, 249, 255));
        assert_eq!(default_background(true), Color(28, 25, 23, 255));
    }
}
