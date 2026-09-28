use std::ffi::{c_char, CStr};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use libloading::Library;

use crate::dictation::protocol::{DictationError, ErrorCode};

pub const HEADER_VERSION: i32 = 30000;

#[repr(C)]
pub struct MoonshineOption {
    pub name: *const c_char,
    pub value: *const c_char,
}

#[repr(C)]
pub struct TranscriptLine {
    pub text: *const c_char,
    pub audio_data: *const f32,
    pub audio_data_count: usize,
    pub start_time: f32,
    pub duration: f32,
    pub id: u64,
    pub is_complete: i8,
    pub is_updated: i8,
    pub is_new: i8,
    pub has_text_changed: i8,
    pub have_speakers_changed: i8,
    pub speaker_spans: *const std::ffi::c_void,
    pub speaker_span_count: u64,
    pub last_transcription_latency_ms: u32,
    pub words: *const std::ffi::c_void,
    pub word_count: u64,
}

#[repr(C)]
pub struct Transcript {
    pub lines: *mut TranscriptLine,
    pub line_count: u64,
}

pub struct Api {
    _lib: Library,
    pub error_to_string: unsafe extern "C" fn(i32) -> *const c_char,
    pub load_from_files:
        unsafe extern "C" fn(*const c_char, u32, *const MoonshineOption, u64, i32) -> i32,
    pub free_transcriber: unsafe extern "C" fn(i32),
    pub create_stream: unsafe extern "C" fn(i32, u32) -> i32,
    pub free_stream: unsafe extern "C" fn(i32, i32) -> i32,
    pub start_stream: unsafe extern "C" fn(i32, i32) -> i32,
    pub stop_stream: unsafe extern "C" fn(i32, i32) -> i32,
    pub add_audio: unsafe extern "C" fn(i32, i32, *const f32, u64, i32, u32) -> i32,
    pub transcribe_stream: unsafe extern "C" fn(i32, i32, u32, *mut *mut Transcript) -> i32,
    pub set_context: unsafe extern "C" fn(i32, *const c_char, i32) -> i32,
}

/// Where libmoonshine.so may live: next to the installed binary's lib dir
/// (deb/rpm/AppImage/Arch put it in `<prefix>/lib/maibuk/`), an override, and
/// the vendored copy in dev builds. libonnxruntime.so.1 sits beside it
/// (libmoonshine's RUNPATH is $ORIGIN).
pub fn library_candidates(exe: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(path) = std::env::var("MAIBUK_MOONSHINE_LIB") {
        out.push(PathBuf::from(path));
    }
    if let Some(bin) = exe.parent() {
        out.push(bin.join("../lib/maibuk/libmoonshine.so"));
        out.push(bin.join("libmoonshine.so"));
    }
    if cfg!(debug_assertions) {
        out.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../vendor/moonshine/linux-x86_64/lib/libmoonshine.so"),
        );
    }
    out
}

static API: OnceLock<Result<Api, String>> = OnceLock::new();

pub fn api() -> Result<&'static Api, DictationError> {
    API.get_or_init(|| {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut tried = Vec::new();
        for candidate in library_candidates(&exe) {
            if !candidate.exists() {
                tried.push(candidate.display().to_string());
                continue;
            }
            // Safety: loading a trusted, pinned library shipped with the app.
            match unsafe { Library::new(&candidate) } {
                Ok(lib) => match unsafe { load_symbols(lib) } {
                    Ok(api) => return Ok(api),
                    Err(error) => tried.push(format!("{}: {error}", candidate.display())),
                },
                Err(error) => tried.push(format!("{}: {error}", candidate.display())),
            }
        }
        Err(format!(
            "library_missing: libmoonshine.so unavailable ({})",
            tried.join(", ")
        ))
    })
    .as_ref()
    .map_err(|detail| DictationError::new(ErrorCode::Unsupported, detail.clone()))
}

unsafe fn load_symbols(lib: Library) -> Result<Api, libloading::Error> {
    macro_rules! sym {
        ($name:literal) => {
            *lib.get($name)?
        };
    }
    Ok(Api {
        error_to_string: sym!(b"moonshine_error_to_string\0"),
        load_from_files: sym!(b"moonshine_load_transcriber_from_files\0"),
        free_transcriber: sym!(b"moonshine_free_transcriber\0"),
        create_stream: sym!(b"moonshine_create_stream\0"),
        free_stream: sym!(b"moonshine_free_stream\0"),
        start_stream: sym!(b"moonshine_start_stream\0"),
        stop_stream: sym!(b"moonshine_stop_stream\0"),
        add_audio: sym!(b"moonshine_transcribe_add_audio_to_stream\0"),
        transcribe_stream: sym!(b"moonshine_transcribe_stream\0"),
        set_context: sym!(b"moonshine_transcriber_set_context\0"),
        _lib: lib,
    })
}

impl Api {
    fn error(&self, code: i32, what: &str, on_error: ErrorCode) -> DictationError {
        let ptr = unsafe { (self.error_to_string)(code) };
        let message = if ptr.is_null() {
            "unknown Moonshine error".into()
        } else {
            unsafe { CStr::from_ptr(ptr) }
                .to_string_lossy()
                .into_owned()
        };
        DictationError::new(on_error, format!("{what}: {message} ({code})"))
    }

    /// Handle-creating calls return a nonnegative handle; errors are negative.
    pub fn check_handle(
        &self,
        code: i32,
        what: &str,
        on_error: ErrorCode,
    ) -> Result<i32, DictationError> {
        if code >= 0 {
            Ok(code)
        } else {
            Err(self.error(code, what, on_error))
        }
    }

    /// Stream operations return zero on success and any nonzero value on error.
    pub fn check_status(
        &self,
        code: i32,
        what: &str,
        on_error: ErrorCode,
    ) -> Result<(), DictationError> {
        if code == 0 {
            Ok(())
        } else {
            Err(self.error(code, what, on_error))
        }
    }
}

/// The lines of a transcript. With no lines yet libmoonshine returns a null
/// `lines` pointer, and from_raw_parts(null, 0) is undefined behaviour.
pub unsafe fn lines<'a>(transcript: *const Transcript) -> &'a [TranscriptLine] {
    unsafe {
        if transcript.is_null() || (*transcript).lines.is_null() || (*transcript).line_count == 0 {
            &[]
        } else {
            std::slice::from_raw_parts((*transcript).lines, (*transcript).line_count as usize)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn null_or_empty_transcripts_have_no_lines() {
        assert!(unsafe { lines(std::ptr::null()) }.is_empty());
        let empty = Transcript {
            lines: std::ptr::null_mut(),
            line_count: 0,
        };
        assert!(unsafe { lines(&empty) }.is_empty());
        let bogus = Transcript {
            lines: std::ptr::null_mut(),
            line_count: 3,
        };
        assert!(unsafe { lines(&bogus) }.is_empty());
    }

    #[test]
    fn looks_beside_the_installed_binary_first() {
        let c = library_candidates(Path::new("/usr/bin/maibuk"));
        assert!(c.contains(&PathBuf::from("/usr/bin/../lib/maibuk/libmoonshine.so")));
    }
}
