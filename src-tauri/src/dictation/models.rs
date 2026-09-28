use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use crate::dictation::crc32c::Crc32c;
use crate::dictation::protocol::{DictationError, ErrorCode, ModelFile, ModelSpec};

const MARKER: &str = ".complete";

pub fn model_dir(base: &Path, id: &str) -> PathBuf {
    base.join("dictation").join(id)
}

fn validate_name(name: &str) -> Result<(), DictationError> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
    {
        return Err(DictationError::new(
            ErrorCode::ModelCorrupt,
            format!("invalid model path component: {name}"),
        ));
    }
    Ok(())
}

fn validate_spec(spec: &ModelSpec) -> Result<(), DictationError> {
    validate_name(&spec.id)?;
    for file in &spec.files {
        validate_name(&file.name)?;
    }
    Ok(())
}

fn io_error(e: std::io::Error) -> DictationError {
    // ENOSPC
    if e.raw_os_error() == Some(28) {
        DictationError::new(ErrorCode::DiskFull, e.to_string())
    } else {
        DictationError::new(ErrorCode::DownloadFailed, e.to_string())
    }
}

fn download(
    file: &ModelFile,
    dest: &Path,
    cancel: &AtomicBool,
    done: &mut u64,
    total: u64,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<(), DictationError> {
    if cancel.load(Ordering::Relaxed) {
        return Err(DictationError::code(ErrorCode::Cancelled));
    }
    let response = match ureq::get(&file.url).call() {
        Ok(r) => r,
        Err(ureq::Error::Status(404 | 410, _)) => {
            return Err(DictationError::new(ErrorCode::ModelGone, file.url.clone()))
        }
        Err(e) => {
            return Err(DictationError::new(
                ErrorCode::DownloadFailed,
                e.to_string(),
            ))
        }
    };
    let part = dest.with_file_name(format!("{}.part", file.name));
    let mut out = File::create(&part).map_err(io_error)?;
    let mut reader = response.into_reader();
    let mut crc = Crc32c::new();
    let mut size = 0u64;
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(DictationError::code(ErrorCode::Cancelled));
        }
        let n = reader
            .read(&mut buf)
            .map_err(|e| DictationError::new(ErrorCode::DownloadFailed, e.to_string()))?;
        if n == 0 {
            break;
        }
        crc.update(&buf[..n]);
        out.write_all(&buf[..n]).map_err(io_error)?;
        size += n as u64;
        *done += n as u64;
        progress(*done, total);
    }
    out.sync_all().map_err(io_error)?;
    if size != file.bytes || crc.digest_base64() != file.checksum.value {
        return Err(DictationError::new(
            ErrorCode::DownloadFailed,
            format!("{}: checksum or size mismatch", file.name),
        ));
    }
    fs::rename(&part, dest).map_err(io_error)
}

/// Downloads every file to `<name>.part`, verifies size and CRC32C, renames,
/// then writes the completion marker. Any failure removes the model's folder.
pub fn install(
    base: &Path,
    spec: &ModelSpec,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<(), DictationError> {
    validate_spec(spec)?;
    let dir = model_dir(base, &spec.id);
    remove(base, &spec.id)?;
    fs::create_dir_all(&dir).map_err(io_error)?;
    let total: u64 = spec.files.iter().map(|f| f.bytes).sum();
    let mut done = 0u64;
    let result = spec
        .files
        .iter()
        .try_for_each(|file| {
            download(
                file,
                &dir.join(&file.name),
                cancel,
                &mut done,
                total,
                progress,
            )
        })
        .and_then(|_| {
            if cancel.load(Ordering::Relaxed) {
                return Err(DictationError::code(ErrorCode::Cancelled));
            }
            fs::write(dir.join(MARKER), b"").map_err(io_error)
        });
    if result.is_err() {
        let _ = fs::remove_dir_all(&dir);
    }
    result
}

pub fn is_complete(base: &Path, spec: &ModelSpec) -> bool {
    verify(base, spec).is_ok()
}

/// Marker present and every file its catalog size (full CRC ran at install).
pub fn verify(base: &Path, spec: &ModelSpec) -> Result<PathBuf, DictationError> {
    validate_spec(spec)?;
    let dir = model_dir(base, &spec.id);
    if !dir.join(MARKER).exists() {
        return Err(DictationError::new(
            ErrorCode::ModelCorrupt,
            "not installed",
        ));
    }
    for file in &spec.files {
        let len = fs::metadata(dir.join(&file.name))
            .map(|m| m.len())
            .unwrap_or(u64::MAX);
        if len != file.bytes {
            return Err(DictationError::new(
                ErrorCode::ModelCorrupt,
                file.name.clone(),
            ));
        }
    }
    Ok(dir)
}

pub fn remove(base: &Path, id: &str) -> Result<(), DictationError> {
    validate_name(id)?;
    match fs::remove_dir_all(model_dir(base, id)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(DictationError::new(
            ErrorCode::DownloadFailed,
            e.to_string(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dictation::protocol::{Capabilities, Checksum};
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::AtomicBool;

    fn serve(files: Vec<(&'static str, Vec<u8>)>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let mut stream = stream.unwrap();
                let mut buf = [0u8; 2048];
                let n = stream.read(&mut buf).unwrap();
                let req = String::from_utf8_lossy(&buf[..n]);
                let path = req.split_whitespace().nth(1).unwrap_or("/").to_string();
                match files.iter().find(|(p, _)| *p == path) {
                    Some((_, body)) => {
                        write!(
                            stream,
                            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            body.len()
                        )
                        .unwrap();
                        stream.write_all(body).unwrap();
                    }
                    None => write!(
                        stream,
                        "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    )
                    .unwrap(),
                }
            }
        });
        format!("http://{addr}")
    }

    fn file(base: &str, name: &str, body: &[u8]) -> ModelFile {
        let mut crc = Crc32c::new();
        crc.update(body);
        ModelFile {
            name: name.into(),
            url: format!("{base}/{name}"),
            bytes: body.len() as u64,
            checksum: Checksum {
                algo: "crc32c".into(),
                value: crc.digest_base64(),
            },
        }
    }

    fn spec(files: Vec<ModelFile>) -> ModelSpec {
        ModelSpec {
            id: "m1".into(),
            engine: "moonshine".into(),
            languages: vec!["en".into()],
            tier: "fast".into(),
            platforms: vec!["tauri-linux".into()],
            files,
            engine_options: Default::default(),
            capabilities: Capabilities {
                casing: true,
                punctuation: true,
                streaming: true,
            },
        }
    }

    #[test]
    fn installs_verifies_and_marks_complete() {
        let base = serve(vec![
            ("/a.ort", b"hello".to_vec()),
            ("/b.bin", b"world!!".to_vec()),
        ]);
        let dir = tempdir();
        let s = spec(vec![
            file(&base, "a.ort", b"hello"),
            file(&base, "b.bin", b"world!!"),
        ]);
        let mut last = 0;
        install(&dir, &s, &AtomicBool::new(false), &mut |done, _| {
            last = done
        })
        .unwrap();
        assert_eq!(last, 12);
        assert!(is_complete(&dir, &s));
        assert!(verify(&dir, &s).is_ok());
        assert!(!model_dir(&dir, "m1").join("a.ort.part").exists());
    }

    #[test]
    fn checksum_mismatch_leaves_nothing() {
        let base = serve(vec![("/a.ort", b"HELLO".to_vec())]);
        let dir = tempdir();
        let s = spec(vec![file(&base, "a.ort", b"hello")]);
        let err = install(&dir, &s, &AtomicBool::new(false), &mut |_, _| {}).unwrap_err();
        assert_eq!(err.code, ErrorCode::DownloadFailed);
        assert!(!model_dir(&dir, "m1").exists());
    }

    #[test]
    fn a_404_is_model_gone() {
        let base = serve(vec![]);
        let dir = tempdir();
        let s = spec(vec![file(&base, "a.ort", b"hello")]);
        assert_eq!(
            install(&dir, &s, &AtomicBool::new(false), &mut |_, _| {})
                .unwrap_err()
                .code,
            ErrorCode::ModelGone
        );
    }

    #[test]
    fn cancel_is_cancelled_and_cleans_up() {
        let base = serve(vec![("/a.ort", b"hello".to_vec())]);
        let dir = tempdir();
        let s = spec(vec![file(&base, "a.ort", b"hello")]);
        assert_eq!(
            install(&dir, &s, &AtomicBool::new(true), &mut |_, _| {})
                .unwrap_err()
                .code,
            ErrorCode::Cancelled
        );
        assert!(!model_dir(&dir, "m1").exists());
    }

    #[test]
    fn a_truncated_file_fails_verify_as_model_corrupt() {
        let base = serve(vec![("/a.ort", b"hello".to_vec())]);
        let dir = tempdir();
        let s = spec(vec![file(&base, "a.ort", b"hello")]);
        install(&dir, &s, &AtomicBool::new(false), &mut |_, _| {}).unwrap();
        std::fs::write(model_dir(&dir, "m1").join("a.ort"), b"hel").unwrap();
        assert_eq!(verify(&dir, &s).unwrap_err().code, ErrorCode::ModelCorrupt);
    }

    #[test]
    fn rejects_paths_that_escape_the_model_directory() {
        let dir = tempdir();
        let sentinel = dir.join("sentinel");
        std::fs::create_dir_all(&sentinel).unwrap();
        std::fs::write(sentinel.join("keep"), b"keep").unwrap();
        assert_eq!(
            remove(&dir, "../sentinel").unwrap_err().code,
            ErrorCode::ModelCorrupt
        );
        assert!(sentinel.join("keep").exists());

        let base = serve(vec![("/outside", b"data".to_vec())]);
        let unsafe_file = file(&base, "../outside", b"data");
        let unsafe_spec = spec(vec![unsafe_file]);
        assert_eq!(
            install(&dir, &unsafe_spec, &AtomicBool::new(false), &mut |_, _| {})
                .unwrap_err()
                .code,
            ErrorCode::ModelCorrupt
        );
        assert!(!dir.join("dictation/outside").exists());
    }

    fn tempdir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "maibuk-models-{}",
            std::process::id() as u64 * 1000 + rand_suffix()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn rand_suffix() -> u64 {
        use std::sync::atomic::{AtomicU64, Ordering};
        static N: AtomicU64 = AtomicU64::new(0);
        N.fetch_add(1, Ordering::Relaxed)
    }
}
