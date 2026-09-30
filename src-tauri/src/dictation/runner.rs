use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::dictation::capture::{Capture, CaptureMsg};
use crate::dictation::engine::SpeechEngine;
use crate::dictation::protocol::{DictationError, DictationEvent, ErrorCode, HostMessage};
use crate::dictation::resample::Resampler;

pub type SharedEngine = Arc<Mutex<Box<dyn SpeechEngine>>>;
type EngineCall<'a> =
    dyn FnMut(&mut dyn SpeechEngine) -> Result<Vec<DictationEvent>, DictationError> + 'a;

/// Where audio comes from; the microphone in the app, a fake in tests.
pub trait AudioSource: Send {
    fn open(&mut self, tx: Sender<CaptureMsg>) -> Result<u32, DictationError>;
    fn close(&mut self);
}

pub struct Microphone(Option<Capture>);

impl Microphone {
    pub fn new() -> Self {
        Self(None)
    }
}

impl Default for Microphone {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioSource for Microphone {
    fn open(&mut self, tx: Sender<CaptureMsg>) -> Result<u32, DictationError> {
        let (capture, rate) = Capture::open(tx)?;
        self.0 = Some(capture);
        Ok(rate)
    }
    fn close(&mut self) {
        self.0 = None;
    }
}

pub struct Runner {
    stop: Arc<AtomicBool>,
    handle: JoinHandle<()>,
}

impl Runner {
    /// Opens capture on its own thread (cpal streams stay on the thread that
    /// made them) and returns once audio is flowing or failed to open.
    pub fn spawn(
        engine: SharedEngine,
        mut source: impl AudioSource + 'static,
        emit: impl Fn(HostMessage) + Send + 'static,
    ) -> Result<Runner, DictationError> {
        let stop = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), DictationError>>();
        let stop_flag = stop.clone();
        let handle = std::thread::Builder::new()
            .name("dictation".into())
            .spawn(move || {
                let (tx, rx) = mpsc::channel();
                let rate = match source.open(tx) {
                    Ok(rate) => rate,
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                        return;
                    }
                };
                let _ = ready_tx.send(Ok(()));
                let send = |event: DictationEvent| emit(HostMessage::Event { event });
                let mut resampler = Resampler::new(rate);
                let (mut level_sq, mut level_n) = (0f32, 0usize);
                let mut last_poll = Instant::now();
                let mut failed = false;
                // A panic inside the engine must end dictation, not the app.
                let guarded = |f: &mut EngineCall<'_>| -> bool {
                    let result = catch_unwind(AssertUnwindSafe(|| {
                        let mut engine = engine.lock().unwrap_or_else(|p| p.into_inner());
                        f(engine.as_mut())
                    }));
                    match result {
                        Ok(Ok(events)) => {
                            for event in events {
                                send(event);
                            }
                            true
                        }
                        Ok(Err(e)) => {
                            send(DictationEvent::Error {
                                code: e.code,
                                detail: e.detail,
                            });
                            false
                        }
                        Err(_) => {
                            send(DictationEvent::Error {
                                code: ErrorCode::EngineCrashed,
                                detail: None,
                            });
                            false
                        }
                    }
                };
                while !stop_flag.load(Ordering::Relaxed) && !failed {
                    match rx.recv_timeout(Duration::from_millis(20)) {
                        Ok(CaptureMsg::Samples(samples)) => {
                            level_sq += samples.iter().map(|s| s * s).sum::<f32>();
                            level_n += samples.len();
                            if level_n >= (rate / 10) as usize {
                                send(DictationEvent::Level {
                                    rms: (level_sq / level_n as f32).sqrt(),
                                });
                                level_sq = 0.0;
                                level_n = 0;
                            }
                            let pcm = resampler.push(&samples);
                            failed = !guarded(&mut |e| e.accept(&pcm).map(|_| Vec::new()));
                        }
                        Ok(CaptureMsg::Failed(detail)) => {
                            send(DictationEvent::Error {
                                code: ErrorCode::MicUnavailable,
                                detail: Some(detail),
                            });
                            failed = true;
                        }
                        Err(RecvTimeoutError::Timeout) => {}
                        Err(RecvTimeoutError::Disconnected) => failed = true,
                    }
                    if !failed && last_poll.elapsed() >= Duration::from_millis(100) {
                        last_poll = Instant::now();
                        failed = !guarded(&mut |e| e.poll());
                    }
                }
                source.close();
                // Stopping ends the loop, not transcription: samples the capture
                // callback queued in the meantime are still the tail of the last
                // phrase. Feed them through the engine before it finishes, or the
                // end of the sentence is lost.
                while let Ok(message) = rx.try_recv() {
                    match message {
                        CaptureMsg::Samples(samples) if !failed => {
                            let pcm = resampler.push(&samples);
                            guarded(&mut |e| e.accept(&pcm).map(|_| Vec::new()));
                        }
                        CaptureMsg::Samples(_) => {}
                        CaptureMsg::Failed(detail) => {
                            send(DictationEvent::Error {
                                code: ErrorCode::MicUnavailable,
                                detail: Some(detail),
                            });
                            failed = true;
                        }
                    }
                }
                guarded(&mut |e| e.finish());
                emit(HostMessage::Stopped);
            })
            .map_err(|e| DictationError::new(ErrorCode::EngineCrashed, e.to_string()))?;
        match ready_rx.recv() {
            Ok(Ok(())) => Ok(Runner { stop, handle }),
            Ok(Err(e)) => {
                let _ = handle.join();
                Err(e)
            }
            Err(_) => Err(DictationError::new(
                ErrorCode::EngineCrashed,
                "capture thread ended",
            )),
        }
    }

    /// Stops capture and returns after the final events and `stopped` were emitted.
    pub fn stop(self) {
        self.stop.store(true, Ordering::Relaxed);
        let _ = self.handle.join();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeEngine {
        accepted: Arc<Mutex<usize>>,
        polled: bool,
    }

    impl SpeechEngine for FakeEngine {
        fn load(
            &mut self,
            _: &std::path::Path,
            _: &crate::dictation::protocol::ModelSpec,
        ) -> Result<(), DictationError> {
            Ok(())
        }
        fn start(&mut self) -> Result<(), DictationError> {
            Ok(())
        }
        fn accept(&mut self, pcm: &[f32]) -> Result<(), DictationError> {
            *self.accepted.lock().unwrap() += pcm.len();
            Ok(())
        }
        fn poll(&mut self) -> Result<Vec<DictationEvent>, DictationError> {
            if self.polled {
                return Ok(vec![]);
            }
            self.polled = true;
            Ok(vec![DictationEvent::Partial { text: "uno".into() }])
        }
        fn finish(&mut self) -> Result<Vec<DictationEvent>, DictationError> {
            Ok(vec![DictationEvent::Final {
                text: "uno dos".into(),
                latency_ms: None,
            }])
        }
    }

    struct FakeSource;

    impl AudioSource for FakeSource {
        fn open(&mut self, tx: mpsc::Sender<CaptureMsg>) -> Result<u32, DictationError> {
            for _ in 0..3 {
                tx.send(CaptureMsg::Samples(vec![0.1; 4800])).unwrap();
            }
            std::mem::forget(tx); // keep the channel open, like a live mic
            Ok(48_000)
        }
        fn close(&mut self) {}
    }

    fn kinds(messages: &[HostMessage]) -> Vec<String> {
        messages
            .iter()
            .map(|m| match m {
                HostMessage::Event {
                    event: DictationEvent::Level { .. },
                } => "level".into(),
                HostMessage::Event {
                    event: DictationEvent::Partial { text },
                } => format!("partial:{text}"),
                HostMessage::Event {
                    event: DictationEvent::Final { text, .. },
                } => format!("final:{text}"),
                HostMessage::Event {
                    event: DictationEvent::Error { .. },
                } => "error".into(),
                HostMessage::Stopped => "stopped".into(),
            })
            .filter(|k| k != "level")
            .collect()
    }

    #[test]
    fn resamples_emits_partials_and_drains_the_final_before_stopped() {
        let accepted = Arc::new(Mutex::new(0));
        let engine: SharedEngine = Arc::new(Mutex::new(Box::new(FakeEngine {
            accepted: accepted.clone(),
            polled: false,
        })));
        let (tx, rx) = mpsc::channel();
        let runner = Runner::spawn(engine, FakeSource, move |m| tx.send(m).unwrap()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(300));
        runner.stop();
        let messages: Vec<HostMessage> = rx.try_iter().collect();
        assert_eq!(*accepted.lock().unwrap(), 3 * 1600);
        assert_eq!(
            kinds(&messages),
            vec!["partial:uno", "final:uno dos", "stopped"]
        );
    }

    /// A live capture can have one more buffer queued the moment it stops; the
    /// runner must accept it before `finish`, not drop it.
    struct ClosingSource {
        tx: Option<mpsc::Sender<CaptureMsg>>,
    }

    impl AudioSource for ClosingSource {
        fn open(&mut self, tx: mpsc::Sender<CaptureMsg>) -> Result<u32, DictationError> {
            for _ in 0..3 {
                tx.send(CaptureMsg::Samples(vec![0.1; 4800])).unwrap();
            }
            self.tx = Some(tx);
            Ok(48_000)
        }
        fn close(&mut self) {
            if let Some(tx) = self.tx.take() {
                let _ = tx.send(CaptureMsg::Samples(vec![0.1; 4800]));
            }
        }
    }

    #[test]
    fn stop_feeds_queued_samples_to_the_engine_before_finishing() {
        let accepted = Arc::new(Mutex::new(0));
        let engine: SharedEngine = Arc::new(Mutex::new(Box::new(FakeEngine {
            accepted: accepted.clone(),
            polled: false,
        })));
        let (tx, rx) = mpsc::channel();
        let runner = Runner::spawn(engine, ClosingSource { tx: None }, move |m| {
            tx.send(m).unwrap()
        })
        .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(100));
        runner.stop();
        let messages: Vec<HostMessage> = rx.try_iter().collect();
        assert_eq!(
            *accepted.lock().unwrap(),
            4 * 1600,
            "samples queued at stop must reach the engine"
        );
        let final_position = messages
            .iter()
            .position(|m| {
                matches!(
                    m,
                    HostMessage::Event {
                        event: DictationEvent::Final { .. }
                    }
                )
            })
            .expect("a final");
        assert_eq!(messages.last(), Some(&HostMessage::Stopped));
        assert!(
            final_position < messages.len() - 1,
            "the final must precede stopped"
        );
    }

    #[test]
    fn an_engine_panic_becomes_engine_crashed_not_a_crash() {
        struct Boom;
        impl SpeechEngine for Boom {
            fn load(
                &mut self,
                _: &std::path::Path,
                _: &crate::dictation::protocol::ModelSpec,
            ) -> Result<(), DictationError> {
                Ok(())
            }
            fn start(&mut self) -> Result<(), DictationError> {
                Ok(())
            }
            fn accept(&mut self, _: &[f32]) -> Result<(), DictationError> {
                panic!("boom")
            }
            fn poll(&mut self) -> Result<Vec<DictationEvent>, DictationError> {
                Ok(vec![])
            }
            fn finish(&mut self) -> Result<Vec<DictationEvent>, DictationError> {
                Ok(vec![])
            }
        }
        let engine: SharedEngine = Arc::new(Mutex::new(Box::new(Boom)));
        let (tx, rx) = mpsc::channel();
        let runner = Runner::spawn(engine, FakeSource, move |m| tx.send(m).unwrap()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(200));
        runner.stop();
        let messages: Vec<HostMessage> = rx.try_iter().collect();
        assert!(messages.iter().any(|m| matches!(
            m,
            HostMessage::Event {
                event: DictationEvent::Error {
                    code: ErrorCode::EngineCrashed,
                    ..
                }
            }
        )));
        assert_eq!(messages.last(), Some(&HostMessage::Stopped));
    }

    // ---------------------------------------------------------------------
    // Conformance harness: real Moonshine models on real WAVs through the
    // production Runner, writing the shared trace JSON that report.py reads.
    // ---------------------------------------------------------------------

    use std::path::Path;

    /// Parses a 16-bit PCM mono WAV by walking RIFF chunks (no crate), like the
    /// spike's `read_wav`.
    fn parse_wav(path: &Path) -> (u32, Vec<f32>) {
        let bytes = std::fs::read(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
        assert!(
            bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE",
            "not a RIFF/WAVE file: {}",
            path.display()
        );
        let (mut off, mut rate, mut channels, mut bits) = (12usize, 0u32, 0u16, 0u16);
        let mut data: &[u8] = &[];
        while off + 8 <= bytes.len() {
            let id = &bytes[off..off + 4];
            let size = u32::from_le_bytes(bytes[off + 4..off + 8].try_into().unwrap()) as usize;
            if id == b"fmt " {
                channels = u16::from_le_bytes(bytes[off + 10..off + 12].try_into().unwrap());
                rate = u32::from_le_bytes(bytes[off + 12..off + 16].try_into().unwrap());
                bits = u16::from_le_bytes(bytes[off + 22..off + 24].try_into().unwrap());
            } else if id == b"data" {
                data = &bytes[off + 8..(off + 8 + size).min(bytes.len())];
            }
            off += 8 + size + (size & 1);
        }
        assert_eq!(bits, 16, "expected 16-bit PCM: {}", path.display());
        assert_eq!(channels, 1, "expected mono: {}", path.display());
        let pcm = data
            .chunks_exact(2)
            .map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0)
            .collect();
        (rate, pcm)
    }

    /// A WAV file replayed as if it were a microphone: 100 ms chunks on an
    /// Instant-based schedule (chunk k at t0 + k*100 ms, no drift accumulation).
    struct WavSource {
        rate: u32,
        pcm: Vec<f32>,
        t0: Arc<Mutex<Option<Instant>>>,
        stop: Arc<AtomicBool>,
    }

    impl WavSource {
        fn new(path: &Path) -> Self {
            let (rate, pcm) = parse_wav(path);
            Self {
                rate,
                pcm,
                t0: Arc::new(Mutex::new(None)),
                stop: Arc::new(AtomicBool::new(false)),
            }
        }

        /// The audio t0 the test keeps: the moment the first chunk is due.
        fn audio_t0(&self) -> Arc<Mutex<Option<Instant>>> {
            self.t0.clone()
        }

        fn samples(&self) -> &[f32] {
            &self.pcm
        }

        fn seconds(path: &Path) -> f64 {
            let (rate, pcm) = parse_wav(path);
            pcm.len() as f64 / rate as f64
        }
    }

    impl AudioSource for WavSource {
        fn open(&mut self, tx: Sender<CaptureMsg>) -> Result<u32, DictationError> {
            let t0 = Instant::now();
            *self.t0.lock().unwrap() = Some(t0);
            let rate = self.rate;
            let chunk = (rate / 10).max(1) as usize;
            let pcm = std::mem::take(&mut self.pcm);
            let stop = self.stop.clone();
            std::thread::spawn(move || {
                for (k, c) in pcm.chunks(chunk).enumerate() {
                    if stop.load(Ordering::Relaxed) {
                        break;
                    }
                    let due = t0 + Duration::from_millis(100 * k as u64);
                    if let Some(wait) = due.checked_duration_since(Instant::now()) {
                        std::thread::sleep(wait);
                    }
                    if tx.send(CaptureMsg::Samples(c.to_vec())).is_err() {
                        break;
                    }
                }
                drop(tx);
            });
            Ok(rate)
        }

        fn close(&mut self) {
            self.stop.store(true, Ordering::Relaxed);
        }
    }

    /// utime + stime of the whole process in seconds, from /proc/self/stat.
    /// Fields 14 and 15 (0-indexed 11 and 12 after the comm field); 100 ticks/s.
    fn cpu_seconds() -> f64 {
        let stat = std::fs::read_to_string("/proc/self/stat").unwrap_or_default();
        let after = &stat[stat.rfind(')').map_or(0, |i| i + 2)..];
        let fields: Vec<&str> = after.split_whitespace().collect();
        let ticks: f64 = fields.get(11).and_then(|s| s.parse().ok()).unwrap_or(0.0)
            + fields.get(12).and_then(|s| s.parse().ok()).unwrap_or(0.0);
        ticks / 100.0
    }

    fn round3(x: f64) -> f64 {
        (x * 1000.0).round() / 1000.0
    }

    /// The trace file's `events`, `trace` and contract checks, pure over the
    /// raw message list so it is unit-testable without a model. `t0` is the
    /// audio t0; times are seconds since it, rounded to 3 decimals.
    fn trace_document(
        model: &str,
        language: &str,
        audio: &str,
        messages: &[(Instant, HostMessage)],
        t0: Instant,
        load_ms: f64,
        cpu_pct: Option<f64>,
    ) -> serde_json::Value {
        let t_of = |i: Instant| round3(i.saturating_duration_since(t0).as_secs_f64());
        let mut events = Vec::new();
        let mut trace = Vec::new();
        let mut violations: Vec<String> = Vec::new();
        let mut pending_first: Option<f64> = None;
        let mut prev_final: Option<String> = None;
        let mut stopped_seen = false;
        let mut stopped_count = 0usize;
        let mut last_is_stopped = false;

        for (instant, message) in messages {
            let t = t_of(*instant);
            match message {
                HostMessage::Stopped => {
                    events.push(serde_json::json!({ "t": t, "type": "stopped" }));
                    stopped_count += 1;
                    stopped_seen = true;
                    last_is_stopped = true;
                }
                HostMessage::Event { event } => match event {
                    DictationEvent::Level { .. } => {}
                    DictationEvent::Partial { text } => {
                        events.push(serde_json::json!({ "t": t, "type": "partial", "text": text }));
                        if pending_first.is_none() {
                            pending_first = Some(t);
                        }
                        if stopped_seen {
                            violations.push("event after stopped: partial".into());
                        }
                        last_is_stopped = false;
                    }
                    DictationEvent::Final { text, latency_ms } => {
                        events.push(serde_json::json!({ "t": t, "type": "final", "text": text }));
                        trace.push(serde_json::json!({
                            "firstTextAudio": pending_first,
                            "completedAudio": t,
                            "finalLatencyMs": latency_ms,
                            "text": text,
                        }));
                        if let Some(previous) = &prev_final {
                            if !previous.is_empty() && previous == text {
                                violations.push(format!("repeated final: {text}"));
                            }
                        }
                        prev_final = Some(text.clone());
                        pending_first = None;
                        if stopped_seen {
                            violations.push("event after stopped: final".into());
                        }
                        last_is_stopped = false;
                    }
                    DictationEvent::Error { code, detail } => {
                        let code = serde_json::to_value(code).unwrap();
                        let mut event =
                            serde_json::json!({ "t": t, "type": "error", "code": code });
                        if let Some(detail) = detail {
                            event["detail"] = serde_json::json!(detail);
                        }
                        events.push(event);
                        violations.push(format!("error event: {code}"));
                        last_is_stopped = false;
                    }
                },
            }
        }
        if stopped_count != 1 {
            violations.push(format!("expected exactly one stopped, got {stopped_count}"));
        } else if !last_is_stopped {
            violations.push("stopped is not the last event".into());
        }

        serde_json::json!({
            "backend": "native",
            "model": model,
            "language": language,
            "audio": audio,
            "summary": {
                "loadMs": load_ms,
                "cpuPctOfOneCore": cpu_pct,
                "longTasksOver50": serde_json::Value::Null,
                "typingEventMaxMs": serde_json::Value::Null,
                "contractViolations": violations,
            },
            "events": events,
            "trace": trace,
        })
    }

    fn write_trace(path: &Path, doc: &serde_json::Value) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .unwrap_or_else(|e| panic!("create {}: {e}", parent.display()));
        }
        std::fs::write(
            path,
            format!("{}\n", serde_json::to_string_pretty(doc).unwrap()),
        )
        .unwrap_or_else(|e| panic!("write {}: {e}", path.display()));
    }

    fn partial(text: &str) -> HostMessage {
        HostMessage::Event {
            event: DictationEvent::Partial { text: text.into() },
        }
    }

    fn final_(text: &str) -> HostMessage {
        HostMessage::Event {
            event: DictationEvent::Final {
                text: text.into(),
                latency_ms: Some(7),
            },
        }
    }

    /// One trace entry per final, with firstTextAudio from the partial that
    /// preceded it.
    #[test]
    fn trace_document_counts_finals_and_their_first_partials() {
        let t0 = Instant::now();
        let at = |ms: u64| t0 + Duration::from_millis(ms);
        let messages = vec![
            (at(100), partial("hola")),
            (at(200), partial("hola mun")),
            (at(300), final_("hola mundo")),
            (at(400), partial("adios")),
            (at(500), final_("adios")),
            (at(600), HostMessage::Stopped),
        ];
        let doc = trace_document("m", "en", "wav", &messages, t0, 12.0, Some(3.5));
        let trace = doc["trace"].as_array().unwrap();
        assert_eq!(trace.len(), 2, "one trace entry per final");
        assert_eq!(trace[0]["firstTextAudio"], 0.1);
        assert_eq!(trace[0]["completedAudio"], 0.3);
        assert_eq!(trace[1]["firstTextAudio"], 0.4);
        assert_eq!(trace[1]["completedAudio"], 0.5);
        assert_eq!(
            doc["summary"]["contractViolations"]
                .as_array()
                .unwrap()
                .len(),
            0
        );
        assert_eq!(doc["events"].as_array().unwrap().len(), 6);
    }

    #[test]
    fn trace_document_flags_events_after_stopped_and_repeated_finals() {
        let t0 = Instant::now();
        let at = |ms: u64| t0 + Duration::from_millis(ms);
        let violations = |doc: &serde_json::Value| -> Vec<String> {
            doc["summary"]["contractViolations"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap().to_string())
                .collect()
        };

        let after = vec![
            (at(0), partial("a")),
            (at(100), final_("a")),
            (at(200), HostMessage::Stopped),
            (at(300), partial("b")),
        ];
        let doc = trace_document("m", "en", "wav", &after, t0, 1.0, None);
        assert!(
            violations(&doc).iter().any(|v| v.contains("after stopped")),
            "a message after stopped is a violation: {:?}",
            violations(&doc)
        );

        let repeated = vec![
            (at(0), final_("same")),
            (at(100), final_("same")),
            (at(200), HostMessage::Stopped),
        ];
        let doc = trace_document("m", "en", "wav", &repeated, t0, 1.0, None);
        assert!(
            violations(&doc)
                .iter()
                .any(|v| v.contains("repeated final")),
            "a repeated final is a violation: {:?}",
            violations(&doc)
        );
    }

    fn write_wav(path: &Path, rate: u32, samples: &[i16]) {
        let data_len = (samples.len() * 2) as u32;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
        bytes.extend_from_slice(b"WAVE");
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes()); // PCM
        bytes.extend_from_slice(&1u16.to_le_bytes()); // mono
        bytes.extend_from_slice(&rate.to_le_bytes());
        bytes.extend_from_slice(&(rate * 2).to_le_bytes()); // byte rate
        bytes.extend_from_slice(&2u16.to_le_bytes()); // block align
        bytes.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_len.to_le_bytes());
        for s in samples {
            bytes.extend_from_slice(&s.to_le_bytes());
        }
        std::fs::write(path, bytes).unwrap();
    }

    #[test]
    fn wav_source_parses_a_16_bit_mono_wav() {
        let path =
            std::env::temp_dir().join(format!("maibuk-conformance-{}.wav", std::process::id()));
        let rate = 8000u32;
        let samples: [i16; 4] = [0, 16384, -16384, 32767];
        write_wav(&path, rate, &samples);

        let source = WavSource::new(&path);
        assert!((WavSource::seconds(&path) - samples.len() as f64 / rate as f64).abs() < 1e-9);
        let got = source.samples();
        assert_eq!(got.len(), samples.len());
        assert!((got[0] - 0.0).abs() < 1e-6);
        assert!((got[1] - 0.5).abs() < 1e-6);
        assert!((got[2] + 0.5).abs() < 1e-6);
        assert!((got[3] - 32767.0 / 32768.0).abs() < 1e-6);

        let _ = std::fs::remove_file(&path);
    }

    /// The vendored runtime root and the catalog models to run, narrowed by
    /// `CONFORMANCE_MODELS=a,b`. The adapter only looks in the vendored
    /// runtime in debug builds; a release harness points libloading at it.
    fn conformance_models() -> (
        std::path::PathBuf,
        Vec<crate::dictation::protocol::ModelSpec>,
    ) {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../vendor/moonshine");
        if std::env::var_os("MAIBUK_MOONSHINE_LIB").is_none() {
            let lib = root.join("linux-x86_64/lib/libmoonshine.so");
            if lib.exists() {
                std::env::set_var("MAIBUK_MOONSHINE_LIB", &lib);
            }
        }
        let catalog: Vec<crate::dictation::protocol::ModelSpec> =
            serde_json::from_str(include_str!("../../../src/features/dictation/catalog.json"))
                .expect("catalog.json");
        let filter: Option<Vec<String>> = std::env::var("CONFORMANCE_MODELS").ok().map(|v| {
            v.split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        });
        let models = catalog
            .into_iter()
            .filter(|spec| filter.as_ref().is_none_or(|f| f.contains(&spec.id)))
            .collect();
        (root, models)
    }

    /// Contextual biasing for a lane run (issue #274), from the environment,
    /// so a run with and without it differs only in these. `{lang}` in a path
    /// is the model's language.
    /// - `BIAS_LABEL`: names the run; its files are `<name>.<label>.json`.
    /// - `BIAS_CONTEXT`: a text file handed to `set_context` after load.
    /// - `BIAS_KEYTERMS`: a comma-separated term list, the `keyterms` load option.
    /// - `BIAS_BOOST`: the `keyterm_boost` load option.
    #[derive(Default)]
    struct Bias {
        label: Option<String>,
        context: Option<String>,
        keyterms: Option<String>,
        boost: Option<String>,
    }

    impl Bias {
        fn from_env(language: &str) -> Self {
            let read = |var: &str| {
                std::env::var(var).ok().map(|template| {
                    let path = template.replace("{lang}", language);
                    std::fs::read_to_string(&path)
                        .unwrap_or_else(|e| panic!("{var}={path}: {e}"))
                        .trim()
                        .to_string()
                })
            };
            Self {
                label: std::env::var("BIAS_LABEL").ok().filter(|l| !l.is_empty()),
                context: read("BIAS_CONTEXT"),
                keyterms: read("BIAS_KEYTERMS"),
                boost: std::env::var("BIAS_BOOST").ok(),
            }
        }

        /// The load options this run adds to the catalog's.
        fn load_spec(
            &self,
            spec: &crate::dictation::protocol::ModelSpec,
        ) -> crate::dictation::protocol::ModelSpec {
            let mut spec = spec.clone();
            if let Some(keyterms) = &self.keyterms {
                spec.engine_options
                    .insert("keyterms".into(), keyterms.clone());
            }
            if let Some(boost) = &self.boost {
                spec.engine_options
                    .insert("keyterm_boost".into(), boost.clone());
            }
            spec
        }

        /// Hands the context over and returns how long `set_context` took.
        fn apply_context(&self, engine: &mut dyn SpeechEngine) -> Option<f64> {
            let context = self.context.as_ref()?;
            let started = Instant::now();
            engine.set_context(context);
            Some(started.elapsed().as_secs_f64() * 1000.0)
        }

        fn file_name(&self, stem: &str) -> String {
            match &self.label {
                Some(label) => format!("{stem}.{label}.json"),
                None => format!("{stem}.json"),
            }
        }

        fn describe(&self) -> serde_json::Value {
            serde_json::json!({
                "label": self.label,
                "contextWords": self.context.as_ref().map(|c| c.split_whitespace().count()),
                "keyterms": self.keyterms.as_ref().map(|k| k.split(',').count()),
                "boost": self.boost,
            })
        }
    }

    #[test]
    fn bias_adds_its_load_options_and_names_its_files() {
        let spec: Vec<crate::dictation::protocol::ModelSpec> =
            serde_json::from_str(include_str!("../../../src/features/dictation/catalog.json"))
                .expect("catalog.json");
        let bias = Bias {
            label: Some("a-keyterms".into()),
            keyterms: Some("Siobhan,Redis".into()),
            boost: Some("3".into()),
            ..Bias::default()
        };
        let loaded = bias.load_spec(&spec[0]);
        assert_eq!(loaded.engine_options["keyterms"], "Siobhan,Redis");
        assert_eq!(loaded.engine_options["keyterm_boost"], "3");
        assert_eq!(
            loaded.engine_options.get("arch"),
            spec[0].engine_options.get("arch")
        );
        assert_eq!(bias.file_name("phrases-x"), "phrases-x.a-keyterms.json");
        assert_eq!(Bias::default().file_name("phrases-x"), "phrases-x.json");
        assert_eq!(
            Bias::default().load_spec(&spec[0]).engine_options,
            spec[0].engine_options
        );
    }

    /// Real models, real WAVs, production Runner. Ignored: run with
    /// `cargo test --release dictation::runner::tests::conformance -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn conformance() {
        let (root, models) = conformance_models();
        for spec in models {
            let language = spec
                .languages
                .first()
                .cloned()
                .unwrap_or_else(|| "en".into());
            let wav_name = if language == "es" {
                "quijote_es_16k.wav"
            } else {
                "two_cities_16k.wav"
            };
            let wav_path = root.join("audio").join(wav_name);
            let dir = root.join("models").join(&spec.id);
            assert!(
                wav_path.exists(),
                "missing {}: run `pnpm fetch:dictation --test-assets`",
                wav_path.display()
            );
            assert!(
                dir.exists(),
                "missing {}: run `pnpm fetch:dictation --test-assets`",
                dir.display()
            );

            let bias = Bias::from_env(&language);
            let mut engine = crate::dictation::engine::create_engine(&spec).expect("create engine");
            let load_start = Instant::now();
            engine
                .load(&dir, &bias.load_spec(&spec))
                .expect("load model");
            let load_ms = load_start.elapsed().as_secs_f64() * 1000.0;
            let set_context_ms = bias.apply_context(engine.as_mut());
            engine.start().expect("start engine");
            let engine: SharedEngine = Arc::new(Mutex::new(engine));

            let source = WavSource::new(&wav_path);
            let t0_handle = source.audio_t0();
            let audio_seconds = WavSource::seconds(&wav_path);

            let messages: Arc<Mutex<Vec<(Instant, HostMessage)>>> =
                Arc::new(Mutex::new(Vec::new()));
            let sink = messages.clone();
            let emit = move |message: HostMessage| {
                sink.lock().unwrap().push((Instant::now(), message));
            };

            let cpu_before = cpu_seconds();
            let wall_start = Instant::now();
            let runner = Runner::spawn(engine, source, emit).expect("spawn runner");
            let t0 = loop {
                if let Some(t0) = *t0_handle.lock().unwrap() {
                    break t0;
                }
                std::thread::sleep(Duration::from_millis(5));
            };
            std::thread::sleep(Duration::from_secs_f64(audio_seconds + 1.5));
            runner.stop();
            let wall = wall_start.elapsed().as_secs_f64();
            let cpu = cpu_seconds() - cpu_before;
            let cpu_pct = ((cpu / wall * 100.0) * 10.0).round() / 10.0;

            // stop() joins the runner thread, which emits Stopped before it
            // returns; wait defensively anyway.
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                if messages
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|(_, m)| matches!(m, HostMessage::Stopped))
                {
                    break;
                }
                assert!(Instant::now() < deadline, "no Stopped within 5 s");
                std::thread::sleep(Duration::from_millis(20));
            }

            let captured = messages.lock().unwrap();
            let mut doc = trace_document(
                &spec.id,
                &language,
                wav_name,
                captured.as_slice(),
                t0,
                load_ms,
                Some(cpu_pct),
            );
            doc["bias"] = bias.describe();
            doc["bias"]["setContextMs"] = serde_json::json!(set_context_ms.map(round3));
            let path = root
                .join("conformance")
                .join(bias.file_name(&format!("native-{}", spec.id)));
            write_trace(&path, &doc);
            let finals = doc["trace"].as_array().unwrap().len();
            let violations = doc["summary"]["contractViolations"]
                .as_array()
                .unwrap()
                .len();
            println!(
                "{:<28} finals={:<3} cpu={cpu_pct:>6.1}% loadMs={load_ms:>8.1} violations={violations}",
                spec.id, finals
            );
        }
    }

    // ---------------------------------------------------------------------
    // Phrase conformance (issue #285): what each model hears in the recorded
    // phrase clips. Clips are fed to the engine straight, in 100 ms chunks
    // with a poll after each, then finished: the same engine and line mapping
    // as a live session, without waiting out the audio in real time.
    // ---------------------------------------------------------------------

    /// The finished lines an engine produces for one clip, in order, with the
    /// latency the engine reported for each.
    struct ClipTranscript {
        finals: Vec<String>,
        latencies: Vec<Option<u32>>,
    }

    fn transcribe_clip(engine: &mut dyn SpeechEngine, pcm: &[f32]) -> ClipTranscript {
        engine.start().expect("start engine");
        let mut finals = Vec::new();
        let mut latencies = Vec::new();
        let mut keep = |events: Vec<DictationEvent>| {
            for event in events {
                match event {
                    DictationEvent::Final { text, latency_ms } => {
                        finals.push(text);
                        latencies.push(latency_ms);
                    }
                    DictationEvent::Error { code, detail } => {
                        panic!("engine error {code:?}: {detail:?}")
                    }
                    _ => {}
                }
            }
        };
        for chunk in pcm.chunks(1_600) {
            engine.accept(chunk).expect("accept audio");
            keep(engine.poll().expect("poll"));
        }
        keep(engine.finish().expect("finish"));
        ClipTranscript { finals, latencies }
    }

    /// The same clip through the production Runner at real-time pace, like a
    /// live microphone. Slower; `PHRASE_REALTIME=1` cross-checks the fast feed.
    fn transcribe_clip_realtime(engine: &SharedEngine, path: &Path) -> Vec<String> {
        engine.lock().unwrap().start().expect("start engine");
        let messages: Arc<Mutex<Vec<HostMessage>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = messages.clone();
        let runner = Runner::spawn(engine.clone(), WavSource::new(path), move |m| {
            sink.lock().unwrap().push(m)
        })
        .expect("spawn runner");
        std::thread::sleep(Duration::from_secs_f64(WavSource::seconds(path) + 1.0));
        runner.stop();
        let captured = messages.lock().unwrap();
        captured
            .iter()
            .filter_map(|m| match m {
                HostMessage::Event {
                    event: DictationEvent::Final { text, .. },
                } => Some(text.clone()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn transcribe_clip_keeps_finals_in_order_and_drops_partials() {
        struct Scripted {
            polls: Vec<Vec<DictationEvent>>,
            started: usize,
        }
        impl SpeechEngine for Scripted {
            fn load(
                &mut self,
                _: &std::path::Path,
                _: &crate::dictation::protocol::ModelSpec,
            ) -> Result<(), DictationError> {
                Ok(())
            }
            fn start(&mut self) -> Result<(), DictationError> {
                self.started += 1;
                Ok(())
            }
            fn accept(&mut self, _: &[f32]) -> Result<(), DictationError> {
                Ok(())
            }
            fn poll(&mut self) -> Result<Vec<DictationEvent>, DictationError> {
                Ok(if self.polls.is_empty() {
                    vec![]
                } else {
                    self.polls.remove(0)
                })
            }
            fn finish(&mut self) -> Result<Vec<DictationEvent>, DictationError> {
                Ok(vec![DictationEvent::Final {
                    text: "right".into(),
                    latency_ms: None,
                }])
            }
        }
        let mut engine = Scripted {
            polls: vec![
                vec![DictationEvent::Partial { text: "al".into() }],
                vec![DictationEvent::Final {
                    text: "Align.".into(),
                    latency_ms: Some(80),
                }],
            ],
            started: 0,
        };
        // 0.25 s of audio is three chunks, so three polls.
        let clip = transcribe_clip(&mut engine, &[0.0; 4_000]);
        assert_eq!(clip.finals, vec!["Align.".to_string(), "right".to_string()]);
        assert_eq!(clip.latencies, vec![Some(80), None]);
        assert_eq!(engine.started, 1);
    }

    /// Real models on the recorded phrase clips. Ignored: run with
    /// `cargo test --release dictation::runner::tests::phrase_transcripts -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn phrase_transcripts() {
        let (root, models) = conformance_models();
        for spec in models {
            let language = spec
                .languages
                .first()
                .cloned()
                .unwrap_or_else(|| "en".into());
            let clips_dir = root.join("phrases").join(&language);
            let mut files: Vec<_> = match std::fs::read_dir(&clips_dir) {
                Ok(entries) => entries
                    .filter_map(|e| e.ok().map(|e| e.path()))
                    .filter(|p| p.extension().is_some_and(|x| x == "wav"))
                    .collect(),
                Err(_) => {
                    println!("{:<28} no clips in {}", spec.id, clips_dir.display());
                    continue;
                }
            };
            files.sort();
            let dir = root.join("models").join(&spec.id);
            assert!(
                dir.exists(),
                "missing {}: run `pnpm fetch:dictation --test-assets`",
                dir.display()
            );
            let bias = Bias::from_env(&language);
            let mut engine = crate::dictation::engine::create_engine(&spec).expect("create engine");
            engine
                .load(&dir, &bias.load_spec(&spec))
                .expect("load model");
            let set_context_ms = bias.apply_context(engine.as_mut());
            let realtime = std::env::var_os("PHRASE_REALTIME").is_some();
            let shared: SharedEngine = Arc::new(Mutex::new(engine));

            let started = Instant::now();
            let mut clips = Vec::new();
            for file in &files {
                let (rate, pcm) = parse_wav(file);
                let pcm = if rate == 16_000 {
                    pcm
                } else {
                    crate::dictation::resample::Resampler::new(rate).push(&pcm)
                };
                let clip_started = Instant::now();
                let clip = if realtime {
                    ClipTranscript {
                        finals: transcribe_clip_realtime(&shared, file),
                        latencies: Vec::new(),
                    }
                } else {
                    transcribe_clip(shared.lock().unwrap().as_mut(), &pcm)
                };
                clips.push(serde_json::json!({
                    "file": file.file_name().unwrap().to_string_lossy(),
                    "finals": clip.finals,
                    "latencies": clip.latencies,
                    "ms": round3(clip_started.elapsed().as_secs_f64() * 1000.0),
                }));
            }
            let doc = serde_json::json!({
                "model": spec.id,
                "language": language,
                "backend": if realtime { "native-realtime" } else { "native" },
                "bias": bias.describe(),
                "setContextMs": set_context_ms.map(round3),
                "clips": clips,
            });
            let stem = format!(
                "phrases-{}{}",
                spec.id,
                if realtime { ".realtime" } else { "" }
            );
            let path = root.join("conformance").join(bias.file_name(&stem));
            write_trace(&path, &doc);
            println!(
                "{:<28} clips={:<4} seconds={:.1}",
                spec.id,
                files.len(),
                started.elapsed().as_secs_f64()
            );
        }
    }

    /// How long `set_context` takes on each passage in `BIAS_TIMING` (comma-
    /// separated paths, `{lang}` for the language), five calls each, median
    /// and worst. Ignored: run with
    /// `cargo test --release dictation::runner::tests::set_context_timing -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn set_context_timing() {
        let (root, models) = conformance_models();
        let templates = std::env::var("BIAS_TIMING").expect("BIAS_TIMING=<path>[,<path>...]");
        let mut rows = Vec::new();
        for spec in models {
            let language = spec
                .languages
                .first()
                .cloned()
                .unwrap_or_else(|| "en".into());
            let dir = root.join("models").join(&spec.id);
            let mut engine = crate::dictation::engine::create_engine(&spec).expect("create engine");
            engine.load(&dir, &spec).expect("load model");
            for template in templates.split(',') {
                let path = template.trim().replace("{lang}", &language);
                let passage =
                    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
                let mut runs: Vec<f64> = (0..5)
                    .map(|_| {
                        let started = Instant::now();
                        engine.set_context(&passage);
                        started.elapsed().as_secs_f64() * 1000.0
                    })
                    .collect();
                engine.set_context("");
                runs.sort_by(|a, b| a.partial_cmp(b).unwrap());
                let words = passage.split_whitespace().count();
                println!(
                    "{:<28} {:>7} words  median {:>8.2} ms  worst {:>8.2} ms  {}",
                    spec.id, words, runs[2], runs[4], path
                );
                rows.push(serde_json::json!({
                    "model": spec.id,
                    "passage": path,
                    "words": words,
                    "medianMs": round3(runs[2]),
                    "worstMs": round3(runs[4]),
                }));
            }
        }
        write_trace(
            &root.join("conformance").join("set-context-timing.json"),
            &serde_json::json!({ "backend": "native", "runs": rows }),
        );
    }
}
