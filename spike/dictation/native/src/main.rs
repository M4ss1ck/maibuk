//! PROTOTYPE. CLI for the dictation spike engine.
//!   dictation-spike <model-dir> <tiny|small> mic [seconds] [key=value ...]
//!   dictation-spike <model-dir> <tiny|small> <file.wav> [key=value ...]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use dictation_spike::{run, Event};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let source = args[3].as_str();
    let rest = &args[4..];
    let seconds: Option<u64> = if source == "mic" { rest.first().and_then(|s| s.parse().ok()).or(Some(30)) } else { None };
    let kv: Vec<(String, String)> = rest
        .iter()
        .filter_map(|a| a.split_once('='))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    let stop = Arc::new(AtomicBool::new(false));
    if let Some(s) = seconds {
        let stop = stop.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(s));
            stop.store(true, Ordering::Relaxed);
        });
    }
    let summary = run(&args[1], args[2] == "small", source, &kv, &stop, &mut |e| match e {
        Event::Partial { text, .. } => eprint!("\r  … {:<100}\r", text.chars().take(100).collect::<String>()),
        Event::Line { text, start, .. } => eprintln!("[{start:6.1}s] {text}"),
        Event::Info(s) => eprintln!("{s}"),
    });
    println!("{summary}");
}
