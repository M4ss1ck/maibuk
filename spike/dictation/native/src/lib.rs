//! PROTOTYPE. Linux native dictation spike (throwaway, never merges).
//!
//! Captures the default microphone with cpal (or replays a WAV in real time),
//! feeds Moonshine's C API on its own thread, and reports latency, CPU, and
//! memory. Same trace format as the web spike, so onsets.py works on both.
//!
//! Used by the `dictation-spike` binary and by src-tauri behind its
//! `dictation-spike` feature.

use std::collections::HashMap;
use std::ffi::{c_char, CStr, CString};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

// ---------- FFI (moonshine-c-api.h, header version 30000) ----------
#[repr(C)]
struct MoonshineOption {
    name: *const c_char,
    value: *const c_char,
}

#[repr(C)]
struct TranscriptLine {
    text: *const c_char,
    audio_data: *const f32,
    audio_data_count: usize,
    start_time: f32,
    duration: f32,
    id: u64,
    is_complete: i8,
    is_updated: i8,
    is_new: i8,
    has_text_changed: i8,
    have_speakers_changed: i8,
    speaker_spans: *const std::ffi::c_void,
    speaker_span_count: u64,
    last_transcription_latency_ms: u32,
    words: *const std::ffi::c_void,
    word_count: u64,
}

#[repr(C)]
struct Transcript {
    lines: *mut TranscriptLine,
    line_count: u64,
}

const HEADER_VERSION: i32 = 30000;
const ARCH_TINY_STREAMING: u32 = 2;
const ARCH_SMALL_STREAMING: u32 = 4;

extern "C" {
    fn moonshine_error_to_string(error: i32) -> *const c_char;
    fn moonshine_load_transcriber_from_files(
        path: *const c_char,
        model_arch: u32,
        options: *const MoonshineOption,
        options_count: u64,
        moonshine_version: i32,
    ) -> i32;
    fn moonshine_create_stream(transcriber: i32, flags: u32) -> i32;
    fn moonshine_start_stream(transcriber: i32, stream: i32) -> i32;
    fn moonshine_stop_stream(transcriber: i32, stream: i32) -> i32;
    fn moonshine_transcribe_add_audio_to_stream(
        transcriber: i32,
        stream: i32,
        audio: *const f32,
        len: u64,
        sample_rate: i32,
        flags: u32,
    ) -> i32;
    fn moonshine_transcribe_stream(transcriber: i32, stream: i32, flags: u32, out: *mut *mut Transcript) -> i32;
}

fn check(code: i32, what: &str) -> i32 {
    if code < 0 {
        let msg = unsafe { CStr::from_ptr(moonshine_error_to_string(code)) }.to_string_lossy();
        panic!("{what}: {msg} ({code})");
    }
    code
}

// ---------- process stats ----------
fn proc_status_kb(key: &str) -> u64 {
    std::fs::read_to_string("/proc/self/status")
        .unwrap_or_default()
        .lines()
        .find(|l| l.starts_with(key))
        .and_then(|l| l.split_whitespace().nth(1)?.parse().ok())
        .unwrap_or(0)
}

/// utime + stime of the whole process, in seconds.
fn cpu_seconds() -> f64 {
    let stat = std::fs::read_to_string("/proc/self/stat").unwrap_or_default();
    let after = &stat[stat.rfind(')').map_or(0, |i| i + 2)..];
    let f: Vec<&str> = after.split_whitespace().collect();
    let ticks: f64 = f[11].parse::<f64>().unwrap_or(0.0) + f[12].parse::<f64>().unwrap_or(0.0);
    ticks / 100.0 // CLK_TCK is 100 on Linux x86_64
}

fn read_wav(path: &str) -> (u32, Vec<f32>) {
    let b = std::fs::read(path).expect("read wav");
    let (mut off, mut rate, mut data) = (12usize, 0u32, &b[0..0]);
    while off + 8 <= b.len() {
        let id = &b[off..off + 4];
        let size = u32::from_le_bytes(b[off + 4..off + 8].try_into().unwrap()) as usize;
        if id == b"fmt " {
            rate = u32::from_le_bytes(b[off + 12..off + 16].try_into().unwrap());
        }
        if id == b"data" {
            data = &b[off + 8..(off + 8 + size).min(b.len())];
        }
        off += 8 + size + (size & 1);
    }
    let pcm = data.chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0).collect();
    (rate, pcm)
}

fn pct(xs: &[f64], q: f64) -> Option<f64> {
    let mut s: Vec<f64> = xs.iter().copied().filter(|x| x.is_finite()).collect();
    if s.is_empty() {
        return None;
    }
    s.sort_by(|a, b| a.partial_cmp(b).unwrap());
    Some((s[((q * s.len() as f64) as usize).min(s.len() - 1)] * 10.0).round() / 10.0)
}

fn json_opt(x: Option<f64>) -> String {
    x.map_or("null".into(), |v| format!("{v}"))
}

fn json_str(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

#[derive(Default)]
struct LineTrace {
    start: f64,
    duration: f64,
    first_text_audio: Option<f64>,
    first_text_wall: Option<Instant>,
    completed_audio: Option<f64>,
    completed_wall: Option<Instant>,
    engine_latency_ms: u32,
    text: String,
}

/// What the engine reports while it runs.
pub enum Event {
    /// The active line's text changed (not yet final).
    Partial { id: u64, text: String },
    /// A line completed; the engine never changes it again.
    Line { id: u64, text: String, start: f32, duration: f32, engine_latency_ms: u32 },
    Info(String),
}

/// Runs one dictation session until `stop` is set (or the WAV ends) and
/// returns the summary + trace JSON. `source` is "mic" or a WAV path.
pub fn run(
    model_dir: &str,
    small: bool,
    source: &str,
    options_kv: &[(String, String)],
    stop: &AtomicBool,
    emit: &mut dyn FnMut(Event),
) -> String {
    let arch = if small { ARCH_SMALL_STREAMING } else { ARCH_TINY_STREAMING };
    let source = source.to_string();
    let kv: Vec<(CString, CString)> = options_kv
        .iter()
        .map(|(k, v)| (CString::new(k.as_str()).unwrap(), CString::new(v.as_str()).unwrap()))
        .collect();
    let options: Vec<MoonshineOption> = kv.iter().map(|(k, v)| MoonshineOption { name: k.as_ptr(), value: v.as_ptr() }).collect();

    let rss_before = proc_status_kb("VmRSS:");
    let t0 = Instant::now();
    let path = CString::new(model_dir).unwrap();
    let tr = check(
        unsafe { moonshine_load_transcriber_from_files(path.as_ptr(), arch, options.as_ptr(), options.len() as u64, HEADER_VERSION) },
        "load",
    );
    let load_ms = t0.elapsed().as_secs_f64() * 1000.0;
    let rss_after_load = proc_status_kb("VmRSS:");
    let stream = check(unsafe { moonshine_create_stream(tr, 0) }, "create_stream");
    check(unsafe { moonshine_start_stream(tr, stream) }, "start_stream");

    // Audio producer: cpal callback or a real-time WAV replay, both sending
    // (samples, sample_rate) over a channel to this thread.
    let (tx, rx) = mpsc::channel::<Vec<f32>>();
    let mut _keep_stream = None;
    let sample_rate: u32;
    if source == "mic" {
        let host = cpal::default_host();
        let device = host.default_input_device().expect("no input device");
        let config = device.default_input_config().expect("input config");
        sample_rate = config.sample_rate().into();
        let channels = config.channels() as usize;
        emit(Event::Info(format!(
            "mic: host={:?} device={:?} rate={} channels={} format={:?}",
            host.id(),
            device.description().map(|d| d.name().to_string()).unwrap_or_default(),
            sample_rate,
            channels,
            config.sample_format()
        )));
        let tx = tx.clone();
        let s = device
            .build_input_stream(
                config.into(),
                move |data: &[f32], _| {
                    let mono: Vec<f32> = data.chunks(channels).map(|f| f.iter().sum::<f32>() / channels as f32).collect();
                    let _ = tx.send(mono);
                },
                |e| eprintln!("cpal error: {e}"),
                None,
            )
            .expect("build_input_stream");
        s.play().expect("play");
        _keep_stream = Some(s);
    } else {
        let (rate, pcm) = read_wav(&source);
        sample_rate = rate;
        let tx = tx.clone();
        std::thread::spawn(move || {
            let chunk = (rate / 10) as usize; // 100 ms, like the web spike
            let start = Instant::now();
            for (i, c) in pcm.chunks(chunk).enumerate() {
                let due = start + Duration::from_millis(100 * (i as u64 + 1));
                if let Some(wait) = due.checked_duration_since(Instant::now()) {
                    std::thread::sleep(wait);
                }
                if tx.send(c.to_vec()).is_err() {
                    return;
                }
            }
        });
    }
    drop(tx);

    // Consumer: add audio as it arrives, transcribe every 100 ms.
    let mut received_sec = 0.0f64;
    let mut received: Vec<(f64, Instant)> = Vec::new();
    let mut traces: HashMap<u64, LineTrace> = HashMap::new();
    let mut order: Vec<u64> = Vec::new();
    let mut pass_ms: Vec<f64> = Vec::new();
    let mut rss_peak = rss_after_load;
    let cpu0 = cpu_seconds();
    let run_start = Instant::now();
    let mut last_pass = Instant::now();
    let mut stopped = false;
    let (mut sum_sq, mut peak, mut n_samples) = (0.0f64, 0.0f32, 0u64);

    let handle = |emit: &mut dyn FnMut(Event), final_pass: bool, received_sec: f64, received: &[(f64, Instant)], traces: &mut HashMap<u64, LineTrace>, order: &mut Vec<u64>, pass_ms: &mut Vec<f64>| {
        let mut out: *mut Transcript = std::ptr::null_mut();
        let p = Instant::now();
        check(unsafe { moonshine_transcribe_stream(tr, stream, 0, &mut out) }, "transcribe_stream");
        pass_ms.push(p.elapsed().as_secs_f64() * 1000.0);
        let now = Instant::now();
        // With no lines yet, libmoonshine returns a null `lines` pointer, and
        // from_raw_parts(null, 0) is undefined behaviour.
        let lines: &[TranscriptLine] = unsafe {
            if out.is_null() || (*out).lines.is_null() || (*out).line_count == 0 {
                &[]
            } else {
                std::slice::from_raw_parts((*out).lines, (*out).line_count as usize)
            }
        };
        for l in lines {
            let text = unsafe { CStr::from_ptr(l.text) }.to_string_lossy().into_owned();
            let t = traces.entry(l.id).or_insert_with(|| {
                order.push(l.id);
                LineTrace::default()
            });
            t.start = l.start_time as f64;
            t.duration = l.duration as f64;
            if t.first_text_audio.is_none() && !text.trim().is_empty() {
                t.first_text_audio = Some(received_sec);
                t.first_text_wall = Some(now);
            }
            if l.is_complete != 0 && t.completed_audio.is_none() {
                t.completed_audio = Some(received_sec);
                t.completed_wall = Some(now);
                t.engine_latency_ms = l.last_transcription_latency_ms;
                emit(Event::Line {
                    id: l.id,
                    text: text.clone(),
                    start: l.start_time,
                    duration: l.duration,
                    engine_latency_ms: l.last_transcription_latency_ms,
                });
            } else if l.has_text_changed != 0 && !final_pass {
                emit(Event::Partial { id: l.id, text: text.clone() });
            }
            t.text = text;
        }
        let _ = received;
    };

    loop {
        match rx.recv_timeout(Duration::from_millis(20)) {
            Ok(chunk) => {
                check(
                    unsafe { moonshine_transcribe_add_audio_to_stream(tr, stream, chunk.as_ptr(), chunk.len() as u64, sample_rate as i32, 0) },
                    "add_audio",
                );
                received_sec += chunk.len() as f64 / sample_rate as f64;
                sum_sq += chunk.iter().map(|x| (*x as f64) * (*x as f64)).sum::<f64>();
                peak = chunk.iter().fold(peak, |m, x| m.max(x.abs()));
                n_samples += chunk.len() as u64;
                received.push((received_sec, Instant::now()));
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
        if stop.load(Ordering::Relaxed) && !stopped {
            _keep_stream = None; // drops the cpal stream, which drops its sender
            stopped = true;
        }
        if last_pass.elapsed() >= Duration::from_millis(100) {
            last_pass = Instant::now();
            handle(emit, false, received_sec, &received, &mut traces, &mut order, &mut pass_ms);
            rss_peak = rss_peak.max(proc_status_kb("VmRSS:"));
        }
        if stopped {
            while rx.try_recv().is_ok() {}
            break;
        }
    }
    check(unsafe { moonshine_stop_stream(tr, stream) }, "stop_stream");
    handle(emit, true, received_sec, &received, &mut traces, &mut order, &mut pass_ms);
    let wall = run_start.elapsed().as_secs_f64();
    let cpu = cpu_seconds() - cpu0;

    let wall_at = |audio: f64| received.iter().find(|(a, _)| *a >= audio).map(|(_, w)| *w);
    let mut first_partial = Vec::new();
    let mut final_ms = Vec::new();
    let mut engine = Vec::new();
    for id in &order {
        let t = &traces[id];
        if let (Some(fw), Some(sw)) = (t.first_text_wall, wall_at(t.start)) {
            first_partial.push(fw.saturating_duration_since(sw).as_secs_f64() * 1000.0);
        }
        if let (Some(cw), Some(ew)) = (t.completed_wall, wall_at(t.start + t.duration)) {
            final_ms.push(cw.saturating_duration_since(ew).as_secs_f64() * 1000.0);
        }
        engine.push(t.engine_latency_ms as f64);
    }
    let trace_json: Vec<String> = order
        .iter()
        .map(|id| {
            let t = &traces[id];
            format!(
                "{{\"start\":{},\"duration\":{},\"firstTextAudio\":{},\"completedAudio\":{},\"text\":{}}}",
                t.start,
                t.duration,
                json_opt(t.first_text_audio),
                json_opt(t.completed_audio),
                json_str(&t.text)
            )
        })
        .collect();
    format!(
        "{{\"summary\":{{\"source\":{},\"arch\":{},\"loadMs\":{:.0},\"audioSec\":{:.1},\"lines\":{},\
\"firstPartialMs\":{{\"p50\":{},\"p95\":{}}},\"finalMs\":{{\"p50\":{},\"p95\":{}}},\"engineFinalMs\":{{\"p50\":{},\"p95\":{}}},\
\"passMs\":{{\"p50\":{},\"p95\":{},\"max\":{}}},\"cpuPctOfOneCore\":{:.1},\"inputDbfs\":{{\"rms\":{:.1},\"peak\":{:.1}}},\
\"rssMB\":{{\"beforeLoad\":{},\"afterLoad\":{},\"peak\":{}}}}},\"trace\":[{}]}}",
        json_str(&source),
        arch,
        load_ms,
        received_sec,
        order.len(),
        json_opt(pct(&first_partial, 0.5)),
        json_opt(pct(&first_partial, 0.95)),
        json_opt(pct(&final_ms, 0.5)),
        json_opt(pct(&final_ms, 0.95)),
        json_opt(pct(&engine, 0.5)),
        json_opt(pct(&engine, 0.95)),
        json_opt(pct(&pass_ms, 0.5)),
        json_opt(pct(&pass_ms, 0.95)),
        json_opt(pct(&pass_ms, 1.0)),
        100.0 * cpu / wall,
        20.0 * ((sum_sq / n_samples.max(1) as f64).sqrt()).max(1e-9).log10(),
        20.0 * (peak as f64).max(1e-9).log10(),
        rss_before / 1024,
        rss_after_load / 1024,
        rss_peak.max(proc_status_kb("VmHWM:")) / 1024,
        trace_json.join(",")
    )
}
