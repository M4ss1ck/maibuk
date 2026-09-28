use std::ffi::{CStr, CString};
use std::path::Path;

use crate::dictation::engine::lines::{LineMapper, LineView};
use crate::dictation::engine::moonshine_ffi::{
    self, Api, MoonshineOption, Transcript, HEADER_VERSION,
};
use crate::dictation::engine::SpeechEngine;
use crate::dictation::protocol::{DictationError, DictationEvent, ErrorCode, ModelSpec};

const ARCH_TINY_STREAMING: u32 = 2;
const ARCH_SMALL_STREAMING: u32 = 4;

pub struct MoonshineEngine {
    api: &'static Api,
    transcriber: Option<i32>,
    stream: Option<i32>,
    mapper: LineMapper,
}

// The C library's handles are plain integers guarded by our Mutex.
unsafe impl Send for MoonshineEngine {}

impl MoonshineEngine {
    pub fn new() -> Result<Self, DictationError> {
        Ok(Self {
            api: moonshine_ffi::api()?,
            transcriber: None,
            stream: None,
            mapper: LineMapper::default(),
        })
    }

    fn handles(&self) -> Result<(i32, i32), DictationError> {
        match (self.transcriber, self.stream) {
            (Some(t), Some(s)) => Ok((t, s)),
            _ => Err(DictationError::new(ErrorCode::EngineCrashed, "not started")),
        }
    }

    fn transcribe(&mut self) -> Result<Vec<DictationEvent>, DictationError> {
        let (t, s) = self.handles()?;
        let mut out: *mut Transcript = std::ptr::null_mut();
        self.api.check_status(
            unsafe { (self.api.transcribe_stream)(t, s, 0, &mut out) },
            "transcribe",
            ErrorCode::EngineCrashed,
        )?;
        let mut events = Vec::new();
        for line in unsafe { moonshine_ffi::lines(out) } {
            let text = if line.text.is_null() {
                String::new()
            } else {
                unsafe { CStr::from_ptr(line.text) }
                    .to_string_lossy()
                    .into_owned()
            };
            self.mapper.map(
                LineView {
                    id: line.id,
                    text: &text,
                    is_complete: line.is_complete != 0,
                    has_text_changed: line.has_text_changed != 0,
                    latency_ms: line.last_transcription_latency_ms,
                },
                &mut events,
            );
        }
        Ok(events)
    }
}

impl SpeechEngine for MoonshineEngine {
    fn load(&mut self, dir: &Path, spec: &ModelSpec) -> Result<(), DictationError> {
        // Without this, ONNX Runtime spins 5-7 cores for Tiny English (spike).
        std::env::set_var("MOONSHINE_ORT_SINGLE_THREAD", "1");
        let arch = match spec.engine_options.get("arch").map(String::as_str) {
            Some("small-streaming") => ARCH_SMALL_STREAMING,
            _ => ARCH_TINY_STREAMING,
        };
        let pairs: Vec<(CString, CString)> = spec
            .engine_options
            .iter()
            .filter(|(k, _)| k.as_str() != "arch")
            .map(|(k, v)| {
                Ok((
                    CString::new(k.as_str())
                        .map_err(|e| DictationError::new(ErrorCode::ModelCorrupt, e.to_string()))?,
                    CString::new(v.as_str())
                        .map_err(|e| DictationError::new(ErrorCode::ModelCorrupt, e.to_string()))?,
                ))
            })
            .collect::<Result<_, DictationError>>()?;
        let options: Vec<MoonshineOption> = pairs
            .iter()
            .map(|(k, v)| MoonshineOption {
                name: k.as_ptr(),
                value: v.as_ptr(),
            })
            .collect();
        let path = CString::new(dir.to_string_lossy().as_bytes())
            .map_err(|e| DictationError::new(ErrorCode::ModelCorrupt, e.to_string()))?;
        if let (Some(old), Some(stream)) = (self.transcriber, self.stream.take()) {
            unsafe { (self.api.free_stream)(old, stream) };
        }
        if let Some(old) = self.transcriber.take() {
            unsafe { (self.api.free_transcriber)(old) };
        }
        let handle = self.api.check_handle(
            unsafe {
                (self.api.load_from_files)(
                    path.as_ptr(),
                    arch,
                    options.as_ptr(),
                    options.len() as u64,
                    HEADER_VERSION,
                )
            },
            "load",
            ErrorCode::ModelCorrupt,
        )?;
        self.transcriber = Some(handle);
        Ok(())
    }

    fn start(&mut self) -> Result<(), DictationError> {
        let t = self
            .transcriber
            .ok_or_else(|| DictationError::new(ErrorCode::EngineCrashed, "load first"))?;
        if let Some(s) = self.stream.take() {
            unsafe { (self.api.free_stream)(t, s) };
        }
        let s = self.api.check_handle(
            unsafe { (self.api.create_stream)(t, 0) },
            "create_stream",
            ErrorCode::EngineCrashed,
        )?;
        if let Err(error) = self.api.check_status(
            unsafe { (self.api.start_stream)(t, s) },
            "start_stream",
            ErrorCode::EngineCrashed,
        ) {
            unsafe { (self.api.free_stream)(t, s) };
            return Err(error);
        }
        self.stream = Some(s);
        self.mapper.reset();
        Ok(())
    }

    fn accept(&mut self, pcm16k: &[f32]) -> Result<(), DictationError> {
        let (t, s) = self.handles()?;
        self.api.check_status(
            unsafe { (self.api.add_audio)(t, s, pcm16k.as_ptr(), pcm16k.len() as u64, 16_000, 0) },
            "add_audio",
            ErrorCode::EngineCrashed,
        )
    }

    fn poll(&mut self) -> Result<Vec<DictationEvent>, DictationError> {
        self.transcribe()
    }

    fn finish(&mut self) -> Result<Vec<DictationEvent>, DictationError> {
        let (t, s) = self.handles()?;
        self.api.check_status(
            unsafe { (self.api.stop_stream)(t, s) },
            "stop_stream",
            ErrorCode::EngineCrashed,
        )?;
        // After stop, one transcribe drains leftover audio with every line complete.
        let events = self.transcribe()?;
        unsafe { (self.api.free_stream)(t, s) };
        self.stream = None;
        Ok(events)
    }

    fn set_context(&mut self, text: &str) {
        if let (Some(t), Ok(c)) = (self.transcriber, CString::new(text)) {
            unsafe { (self.api.set_context)(t, c.as_ptr(), 0) };
        }
    }
}

impl Drop for MoonshineEngine {
    fn drop(&mut self) {
        if let Some(t) = self.transcriber {
            if let Some(s) = self.stream {
                unsafe { (self.api.free_stream)(t, s) };
            }
            unsafe { (self.api.free_transcriber)(t) };
        }
    }
}
