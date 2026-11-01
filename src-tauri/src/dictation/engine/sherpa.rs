//! sherpa-onnx engines (issue #663). `canary` is an offline multilingual model
//! behind Silero VAD: each detected speech segment is decoded once and becomes
//! one final, so it never streams partials. `transducer` is a streaming model
//! whose endpointing closes a line. Only this file knows sherpa-onnx.

use std::path::Path;
use std::time::Instant;

use sherpa_onnx::{
    OfflineCanaryModelConfig, OfflineModelConfig, OfflineRecognizer, OfflineRecognizerConfig,
    OnlineModelConfig, OnlineRecognizer, OnlineRecognizerConfig, OnlineStream,
    OnlineTransducerModelConfig, SileroVadModelConfig, VadModelConfig, VoiceActivityDetector,
};

use crate::dictation::engine::lines::{LineMapper, LineView};
use crate::dictation::engine::SpeechEngine;
use crate::dictation::protocol::{DictationError, DictationEvent, ErrorCode, ModelSpec};

const SAMPLE_RATE: i32 = 16_000;
/// Silero reads its input in windows of this many samples.
const VAD_WINDOW: usize = 512;
/// How much audio the detector may hold before it must hand out a segment.
const VAD_BUFFER_SECONDS: f32 = 60.0;
const THREADS: i32 = 2;
/// Silence fed after the last audio so the transducer emits its trailing words.
const TAIL_SILENCE_SAMPLES: usize = 12_800; // 0.8 s

#[derive(Default)]
pub struct SherpaEngine {
    backend: Option<Backend>,
    lines: Lines,
}

impl SherpaEngine {
    pub fn new() -> Self {
        Self::default()
    }
}

// The sherpa-onnx handles are used only behind the Mutex that owns this engine.
unsafe impl Send for SherpaEngine {}

enum Backend {
    Canary(Canary),
    Transducer(Transducer),
}

struct Canary {
    recognizer: OfflineRecognizer,
    vad_config: VadModelConfig,
    vad: Option<VoiceActivityDetector>,
    /// Audio that does not yet fill a VAD window.
    pending: Vec<f32>,
}

struct Transducer {
    recognizer: OnlineRecognizer,
    language: String,
    stream: Option<OnlineStream>,
}

/// Moonshine's line model: one id per line, partials dedupe, finals are immutable.
#[derive(Default)]
struct Lines {
    mapper: LineMapper,
    current: u64,
}

impl Lines {
    fn reset(&mut self) {
        *self = Self::default();
    }

    fn partial(&mut self, text: &str, latency_ms: u32, out: &mut Vec<DictationEvent>) {
        self.mapper.map(
            LineView {
                id: self.current,
                text,
                is_complete: false,
                has_text_changed: true,
                latency_ms,
            },
            out,
        );
    }

    fn finish(&mut self, text: &str, latency_ms: u32, out: &mut Vec<DictationEvent>) {
        self.mapper.map(
            LineView {
                id: self.current,
                text,
                is_complete: true,
                has_text_changed: true,
                latency_ms,
            },
            out,
        );
        self.current += 1;
    }
}

fn invalid(detail: impl Into<String>) -> DictationError {
    DictationError::new(ErrorCode::ModelCorrupt, detail)
}

fn not_started() -> DictationError {
    DictationError::new(ErrorCode::EngineCrashed, "not started")
}

/// An engine option from the catalog entry (`model`, `encoder`, `min_silence`, ...).
fn option<'a>(spec: &'a ModelSpec, key: &str) -> Result<&'a str, DictationError> {
    spec.engine_options
        .get(key)
        .map(String::as_str)
        .ok_or_else(|| invalid(format!("missing engine option {key}")))
}

/// A model file that an engine option names, which must exist in the model folder.
fn file(dir: &Path, spec: &ModelSpec, key: &str) -> Result<String, DictationError> {
    let path = dir.join(option(spec, key)?);
    if !path.is_file() {
        return Err(invalid(format!("missing model file {}", path.display())));
    }
    Ok(path.to_string_lossy().into_owned())
}

fn number(spec: &ModelSpec, key: &str) -> Result<f32, DictationError> {
    option(spec, key)?
        .parse()
        .map_err(|_| invalid(format!("engine option {key} is not a number")))
}

fn elapsed_ms(started: Instant) -> u32 {
    u32::try_from(started.elapsed().as_millis()).unwrap_or(u32::MAX)
}

fn decode(recognizer: &OfflineRecognizer, samples: &[f32]) -> String {
    let stream = recognizer.create_stream();
    stream.accept_waveform(SAMPLE_RATE, samples);
    recognizer.decode(&stream);
    stream.get_result().map(|r| r.text).unwrap_or_default()
}

fn load_canary(dir: &Path, spec: &ModelSpec, language: &str) -> Result<Canary, DictationError> {
    // Every file and number is checked before the native library sees anything.
    let encoder = file(dir, spec, "encoder")?;
    let decoder = file(dir, spec, "decoder")?;
    let tokens = file(dir, spec, "tokens")?;
    let vad_model = file(dir, spec, "vad")?;
    let min_silence = number(spec, "min_silence")?;
    let max_line = number(spec, "max_line")?;

    let config = OfflineRecognizerConfig {
        model_config: OfflineModelConfig {
            canary: OfflineCanaryModelConfig {
                encoder: Some(encoder),
                decoder: Some(decoder),
                src_lang: Some(language.into()),
                tgt_lang: Some(language.into()),
                ..Default::default()
            },
            tokens: Some(tokens),
            num_threads: THREADS,
            ..Default::default()
        },
        ..Default::default()
    };
    let recognizer =
        OfflineRecognizer::create(&config).ok_or_else(|| invalid("canary recognizer"))?;
    let vad_config = VadModelConfig {
        silero_vad: SileroVadModelConfig {
            model: Some(vad_model),
            threshold: 0.5,
            min_silence_duration: min_silence,
            min_speech_duration: 0.25,
            window_size: VAD_WINDOW as i32,
            max_speech_duration: max_line,
        },
        sample_rate: SAMPLE_RATE,
        num_threads: 1,
        ..Default::default()
    };
    Ok(Canary {
        recognizer,
        vad_config,
        vad: None,
        pending: Vec::new(),
    })
}

fn load_transducer(
    dir: &Path,
    spec: &ModelSpec,
    language: &str,
) -> Result<Transducer, DictationError> {
    let encoder = file(dir, spec, "encoder")?;
    let decoder = file(dir, spec, "decoder")?;
    let joiner = file(dir, spec, "joiner")?;
    let tokens = file(dir, spec, "tokens")?;

    let config = OnlineRecognizerConfig {
        model_config: OnlineModelConfig {
            transducer: OnlineTransducerModelConfig {
                encoder: Some(encoder),
                decoder: Some(decoder),
                joiner: Some(joiner),
            },
            tokens: Some(tokens),
            num_threads: THREADS,
            ..Default::default()
        },
        decoding_method: Some("greedy_search".into()),
        enable_endpoint: true,
        rule1_min_trailing_silence: 2.4,
        rule2_min_trailing_silence: 0.8,
        rule3_min_utterance_length: 30.0,
        ..Default::default()
    };
    let recognizer =
        OnlineRecognizer::create(&config).ok_or_else(|| invalid("transducer recognizer"))?;
    Ok(Transducer {
        recognizer,
        language: language.into(),
        stream: None,
    })
}

impl Canary {
    fn drain(
        &mut self,
        lines: &mut Lines,
        out: &mut Vec<DictationEvent>,
    ) -> Result<(), DictationError> {
        let vad = self.vad.as_ref().ok_or_else(not_started)?;
        while let Some(segment) = vad.front() {
            let samples = segment.samples().to_vec();
            drop(segment);
            vad.pop();
            let started = Instant::now();
            let text = decode(&self.recognizer, &samples);
            lines.finish(&text, elapsed_ms(started), out);
        }
        Ok(())
    }

    fn finish(
        &mut self,
        lines: &mut Lines,
        out: &mut Vec<DictationEvent>,
    ) -> Result<(), DictationError> {
        let vad = self.vad.as_ref().ok_or_else(not_started)?;
        // Pad the partial window with silence so the detector sees every sample.
        let mut tail = std::mem::take(&mut self.pending);
        tail.resize(VAD_WINDOW, 0.0);
        vad.accept_waveform(&tail);
        vad.flush();
        self.drain(lines, out)?;
        self.vad = None;
        Ok(())
    }
}

impl Transducer {
    fn drain(
        &mut self,
        lines: &mut Lines,
        out: &mut Vec<DictationEvent>,
    ) -> Result<(), DictationError> {
        let stream = self.stream.as_ref().ok_or_else(not_started)?;
        let started = Instant::now();
        while self.recognizer.is_ready(stream) {
            self.recognizer.decode(stream);
        }
        let latency = elapsed_ms(started);
        let text = self
            .recognizer
            .get_result(stream)
            .map(|r| r.text)
            .unwrap_or_default();
        if self.recognizer.is_endpoint(stream) {
            lines.finish(&text, latency, out);
            self.recognizer.reset(stream);
        } else {
            lines.partial(&text, latency, out);
        }
        Ok(())
    }

    fn finish(
        &mut self,
        lines: &mut Lines,
        out: &mut Vec<DictationEvent>,
    ) -> Result<(), DictationError> {
        let stream = self.stream.take().ok_or_else(not_started)?;
        stream.accept_waveform(SAMPLE_RATE, &vec![0.0; TAIL_SILENCE_SAMPLES]);
        stream.input_finished();
        let started = Instant::now();
        while self.recognizer.is_ready(&stream) {
            self.recognizer.decode(&stream);
        }
        let text = self
            .recognizer
            .get_result(&stream)
            .map(|r| r.text)
            .unwrap_or_default();
        lines.finish(&text, elapsed_ms(started), out);
        Ok(())
    }
}

impl SpeechEngine for SherpaEngine {
    fn load(&mut self, dir: &Path, spec: &ModelSpec, language: &str) -> Result<(), DictationError> {
        let backend = match option(spec, "model")? {
            "canary" => Backend::Canary(load_canary(dir, spec, language)?),
            "transducer" => Backend::Transducer(load_transducer(dir, spec, language)?),
            other => {
                return Err(DictationError::new(
                    ErrorCode::Unsupported,
                    format!("sherpa model {other}"),
                ))
            }
        };
        self.backend = Some(backend);
        Ok(())
    }

    fn start(&mut self) -> Result<(), DictationError> {
        let backend = self.backend.as_mut().ok_or_else(not_started)?;
        self.lines.reset();
        match backend {
            Backend::Canary(canary) => {
                // A fresh detector per dictation: it holds audio it has not closed yet.
                canary.vad = Some(
                    VoiceActivityDetector::create(&canary.vad_config, VAD_BUFFER_SECONDS)
                        .ok_or_else(|| {
                            DictationError::new(ErrorCode::EngineCrashed, "voice activity detector")
                        })?,
                );
                canary.pending.clear();
            }
            Backend::Transducer(transducer) => {
                let stream = transducer.recognizer.create_stream();
                stream.set_option("language", &transducer.language);
                transducer.stream = Some(stream);
            }
        }
        Ok(())
    }

    fn accept(&mut self, pcm16k: &[f32]) -> Result<(), DictationError> {
        match self.backend.as_mut().ok_or_else(not_started)? {
            Backend::Canary(canary) => {
                canary.pending.extend_from_slice(pcm16k);
                let whole = canary.pending.len() / VAD_WINDOW * VAD_WINDOW;
                let vad = canary.vad.as_ref().ok_or_else(not_started)?;
                for window in canary.pending[..whole].chunks_exact(VAD_WINDOW) {
                    vad.accept_waveform(window);
                }
                canary.pending.drain(..whole);
            }
            Backend::Transducer(transducer) => {
                let stream = transducer.stream.as_ref().ok_or_else(not_started)?;
                stream.accept_waveform(SAMPLE_RATE, pcm16k);
            }
        }
        Ok(())
    }

    fn poll(&mut self) -> Result<Vec<DictationEvent>, DictationError> {
        let mut out = Vec::new();
        match self.backend.as_mut().ok_or_else(not_started)? {
            Backend::Canary(canary) => canary.drain(&mut self.lines, &mut out)?,
            Backend::Transducer(transducer) => transducer.drain(&mut self.lines, &mut out)?,
        }
        Ok(out)
    }

    fn finish(&mut self) -> Result<Vec<DictationEvent>, DictationError> {
        let mut out = Vec::new();
        match self.backend.as_mut().ok_or_else(not_started)? {
            Backend::Canary(canary) => canary.finish(&mut self.lines, &mut out)?,
            Backend::Transducer(transducer) => transducer.finish(&mut self.lines, &mut out)?,
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dictation::protocol::Capabilities;
    use std::collections::BTreeMap;

    fn spec(options: &[(&str, &str)]) -> ModelSpec {
        ModelSpec {
            id: "test".into(),
            name: "Test".into(),
            engine: "sherpa".into(),
            languages: vec!["en".into()],
            tier: "fast".into(),
            platforms: vec!["tauri-linux".into()],
            files: Vec::new(),
            engine_options: options
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect::<BTreeMap<_, _>>(),
            capabilities: Capabilities {
                casing: true,
                punctuation: true,
                streaming: true,
            },
            source: "https://example.test/model".into(),
            installed_bytes: None,
        }
    }

    /// An empty folder under the system temp dir, unique to this test.
    fn empty_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("sherpa-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    const CANARY: &[(&str, &str)] = &[
        ("model", "canary"),
        ("encoder", "encoder.int8.onnx"),
        ("decoder", "decoder.int8.onnx"),
        ("tokens", "tokens.txt"),
        ("vad", "silero_vad.onnx"),
        ("min_silence", "0.5"),
        ("max_line", "8"),
    ];

    #[test]
    fn an_unknown_model_is_unsupported() {
        let mut engine = SherpaEngine::default();
        let error = engine
            .load(
                Path::new("/nonexistent"),
                &spec(&[("model", "whisper")]),
                "en",
            )
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::Unsupported);
    }

    #[test]
    fn a_missing_engine_option_is_model_corrupt() {
        let mut engine = SherpaEngine::default();
        let dir = empty_dir("option");
        for name in ["encoder.int8.onnx", "decoder.int8.onnx", "tokens.txt"] {
            std::fs::write(dir.join(name), b"").unwrap();
        }
        let options: Vec<_> = CANARY
            .iter()
            .copied()
            .filter(|(k, _)| *k != "vad")
            .collect();
        let error = engine.load(&dir, &spec(&options), "en").unwrap_err();
        assert_eq!(error.code, ErrorCode::ModelCorrupt);
        assert_eq!(error.detail.as_deref(), Some("missing engine option vad"));
    }

    #[test]
    fn a_missing_model_file_is_model_corrupt() {
        let mut engine = SherpaEngine::default();
        let dir = empty_dir("file");
        let error = engine.load(&dir, &spec(CANARY), "en").unwrap_err();
        assert_eq!(error.code, ErrorCode::ModelCorrupt);
        assert!(error.detail.unwrap().starts_with("missing model file"));
    }

    #[test]
    fn a_non_numeric_threshold_option_is_model_corrupt() {
        let mut engine = SherpaEngine::default();
        let dir = empty_dir("number");
        for name in [
            "encoder.int8.onnx",
            "decoder.int8.onnx",
            "tokens.txt",
            "silero_vad.onnx",
        ] {
            std::fs::write(dir.join(name), b"").unwrap();
        }
        let options: Vec<_> = CANARY
            .iter()
            .map(|(k, v)| (*k, if *k == "min_silence" { "soon" } else { *v }))
            .collect();
        let error = engine.load(&dir, &spec(&options), "en").unwrap_err();
        assert_eq!(error.code, ErrorCode::ModelCorrupt);
        assert_eq!(
            error.detail.as_deref(),
            Some("engine option min_silence is not a number")
        );
    }

    #[test]
    fn audio_before_load_is_an_engine_error() {
        let mut engine = SherpaEngine::default();
        assert_eq!(engine.start().unwrap_err().code, ErrorCode::EngineCrashed);
        assert_eq!(
            engine.accept(&[0.0; 16]).unwrap_err().code,
            ErrorCode::EngineCrashed
        );
    }
}
