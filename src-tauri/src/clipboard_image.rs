//! The image file a file manager put on the OS clipboard.
//!
//! On Linux a copy in the file manager reaches the clipboard as text: a path, a
//! `file://` URI, or GNOME's `copy\n<uri>` line. The fs scope forbids the
//! webview from reading that path, so Rust reads the file and hands the bytes
//! over. The command takes no path argument: the webview can only ever receive
//! a file the author copied themselves, never an arbitrary one it names.

use std::path::{Path, PathBuf};

use tauri::ipc::Response;
use tauri_plugin_clipboard_manager::ClipboardExt;

/// The largest copied image the command sends to the webview.
const MAX_BYTES: u64 = 32 * 1024 * 1024;

/// The copied file: its path and MIME type, when the clipboard text names an
/// image. GNOME's copied-files text starts with the verb on its own line.
pub fn image_file_from_clipboard_text(text: &str) -> Option<(PathBuf, &'static str)> {
    let line = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !matches!(*line, "copy" | "cut"))?;

    let path = if line.starts_with("file://") {
        tauri::Url::parse(line).ok()?.to_file_path().ok()?
    } else if Path::new(line).is_absolute() {
        PathBuf::from(line)
    } else {
        return None;
    };

    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    let mime = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        _ => return None,
    };
    Some((path, mime))
}

/// The copied image file's bytes, read from the path the OS clipboard holds.
///
/// The command takes no path argument on purpose: the fs scope keeps the
/// webview from reading a copied file, and accepting a path would hand it back
/// the ability to read any file it names. The only path it reads is the one the
/// author just copied.
///
/// A clipboard with no text, or text that names no image, returns an empty
/// response, meaning "no copied image file". Otherwise the response is the MIME
/// type, one `\n`, then the file bytes, so the webview can build a blob from the
/// bytes after the first newline.
#[tauri::command]
pub async fn read_clipboard_image_file(app: tauri::AppHandle) -> Result<Response, String> {
    let Ok(text) = app.clipboard().read_text() else {
        return Ok(Response::new(Vec::new()));
    };
    let Some((path, mime)) = image_file_from_clipboard_text(&text) else {
        return Ok(Response::new(Vec::new()));
    };

    let Ok(metadata) = std::fs::metadata(&path) else {
        return Ok(Response::new(Vec::new()));
    };
    if metadata.len() > MAX_BYTES {
        return Err("too large".into());
    }
    let Ok(bytes) = std::fs::read(&path) else {
        return Ok(Response::new(Vec::new()));
    };

    let mut response = Vec::with_capacity(mime.len() + 1 + bytes.len());
    response.extend_from_slice(mime.as_bytes());
    response.push(b'\n');
    response.extend_from_slice(&bytes);
    Ok(Response::new(response))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_absolute_path_names_an_image() {
        assert_eq!(
            image_file_from_clipboard_text("/home/author/cover.png"),
            Some((PathBuf::from("/home/author/cover.png"), "image/png"))
        );
    }

    #[test]
    fn a_file_uri_is_percent_decoded() {
        assert_eq!(
            image_file_from_clipboard_text("file:///home/author/My%20Cover.webp"),
            Some((PathBuf::from("/home/author/My Cover.webp"), "image/webp"))
        );
    }

    #[test]
    fn gnome_copied_files_text_skips_the_verb() {
        assert_eq!(
            image_file_from_clipboard_text("copy\nfile:///home/author/cover.jpg"),
            Some((PathBuf::from("/home/author/cover.jpg"), "image/jpeg"))
        );
    }

    #[test]
    fn an_uppercase_extension_still_names_an_image() {
        assert_eq!(
            image_file_from_clipboard_text("file:///home/author/Cover.PNG"),
            Some((PathBuf::from("/home/author/Cover.PNG"), "image/png"))
        );
    }

    #[test]
    fn a_relative_path_is_ignored() {
        assert_eq!(image_file_from_clipboard_text("covers/front.png"), None);
    }

    #[test]
    fn a_non_image_extension_is_ignored() {
        assert_eq!(
            image_file_from_clipboard_text("file:///home/author/notes.txt"),
            None
        );
    }

    #[test]
    fn empty_text_is_ignored() {
        assert_eq!(image_file_from_clipboard_text(""), None);
    }
}
