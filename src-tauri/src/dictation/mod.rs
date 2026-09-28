//! Dictation's desktop backend. Same shape as the web worker:
//! capture → Resampler16k → SpeechEngine → DictationEvents over a Channel.
//! Only `engine/moonshine*.rs` knows Moonshine. Linux only for now; other
//! targets expose the same commands answering `unsupported`.
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
