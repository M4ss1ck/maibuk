//! PROTOTYPE (spike-voice-dictation branch only, never merges). Runs the
//! native Moonshine engine from spike/dictation/native on its own thread and
//! streams lines to the webview over a Tauri Channel.
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::ipc::Channel;

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum DictationEvent {
    // Line ids are 64-bit; strings keep them exact in JS.
    Partial { id: String, text: String, sent_ms: f64 },
    Line { id: String, text: String, start: f32, duration: f32, engine_latency_ms: u32, sent_ms: f64 },
    Info { message: String },
    Done { summary: String },
}

static STOP: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

fn spike_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../spike/dictation")
}

fn epoch_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0)
}

/// `source` is "mic" or an audio file name under spike/dictation/public/audio.
#[tauri::command]
pub fn dictation_spike_start(
    model: String,
    source: String,
    options: Vec<(String, String)>,
    single_thread: bool,
    on_event: Channel<DictationEvent>,
) -> Result<(), String> {
    let stop = Arc::new(AtomicBool::new(false));
    if let Some(prev) = STOP.lock().unwrap().replace(stop.clone()) {
        prev.store(true, Ordering::Relaxed);
    }
    // Read by onnxruntime session setup in libmoonshine; set before loading.
    std::env::set_var("MOONSHINE_ORT_SINGLE_THREAD", if single_thread { "1" } else { "0" });
    let model_dir = spike_dir().join("public/models").join(&model);
    let source = if source == "mic" { source } else { spike_dir().join("public/audio").join(&source).display().to_string() };
    std::thread::Builder::new()
        .name("dictation-spike".into())
        .spawn(move || {
            let summary = dictation_spike::run(
                &model_dir.display().to_string(),
                model.starts_with("small"),
                &source,
                &options,
                &stop,
                &mut |e| {
                    let _ = on_event.send(match e {
                        dictation_spike::Event::Partial { id, text } => DictationEvent::Partial { id: id.to_string(), text, sent_ms: epoch_ms() },
                        dictation_spike::Event::Line { id, text, start, duration, engine_latency_ms } => DictationEvent::Line {
                            id: id.to_string(),
                            text,
                            start,
                            duration,
                            engine_latency_ms,
                            sent_ms: epoch_ms(),
                        },
                        dictation_spike::Event::Info(message) => DictationEvent::Info { message },
                    });
                },
            );
            let _ = on_event.send(DictationEvent::Done { summary });
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn dictation_spike_stop() {
    if let Some(stop) = STOP.lock().unwrap().take() {
        stop.store(true, Ordering::Relaxed);
    }
}

/// Writes the page's report to spike/dictation/results/tauri-<name>.json.
#[tauri::command]
pub fn dictation_spike_report(name: String, json: String) -> Result<(), String> {
    let safe: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '.').collect();
    let dir = spike_dir().join("results");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("tauri-{safe}.json")), json).map_err(|e| e.to_string())
}
