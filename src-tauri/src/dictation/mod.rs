//! Dictation's desktop backend. Same shape as the web worker:
//! capture → Resampler16k → SpeechEngine → DictationEvents over a Channel.
//! Only `engine/moonshine*.rs` knows Moonshine. Linux only for now; Task 16
//! adds the Tauri command surface and non-Linux `unsupported` replies.
pub mod crc32c;
pub mod protocol;
pub mod resample;

#[cfg(target_os = "linux")]
mod capture;
#[cfg(target_os = "linux")]
pub mod engine;
#[cfg(target_os = "linux")]
mod models;
#[cfg(target_os = "linux")]
mod runner;

mod commands;
