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
}
