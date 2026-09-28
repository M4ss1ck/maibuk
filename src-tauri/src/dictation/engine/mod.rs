use std::path::Path;

use crate::dictation::protocol::{DictationError, DictationEvent, ErrorCode, ModelSpec};

pub mod lines;
pub mod moonshine;
pub mod moonshine_ffi;

/// The swap point. Engines see verified model files and 16 kHz mono PCM, and
/// report protocol events. Adding an engine is one impl plus a match arm.
pub trait SpeechEngine: Send {
    fn load(&mut self, dir: &Path, spec: &ModelSpec) -> Result<(), DictationError>;
    fn start(&mut self) -> Result<(), DictationError>;
    fn accept(&mut self, pcm16k: &[f32]) -> Result<(), DictationError>;
    fn poll(&mut self) -> Result<Vec<DictationEvent>, DictationError>;
    fn finish(&mut self) -> Result<Vec<DictationEvent>, DictationError>;
    fn set_context(&mut self, _text: &str) {}
}

pub fn create_engine(spec: &ModelSpec) -> Result<Box<dyn SpeechEngine>, DictationError> {
    match spec.engine.as_str() {
        "moonshine" => Ok(Box::new(moonshine::MoonshineEngine::new()?)),
        other => Err(DictationError::new(
            ErrorCode::Unsupported,
            format!("engine {other}"),
        )),
    }
}
