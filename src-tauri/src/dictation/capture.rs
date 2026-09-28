use std::sync::mpsc::Sender;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use crate::dictation::protocol::{DictationError, ErrorCode};

pub enum CaptureMsg {
    Samples(Vec<f32>),
    Failed(String),
}

/// The default input device as mono f32 at its native rate.
pub struct Capture {
    _stream: cpal::Stream,
}

impl Capture {
    pub fn open(tx: Sender<CaptureMsg>) -> Result<(Capture, u32), DictationError> {
        let device = cpal::default_host()
            .default_input_device()
            .ok_or_else(|| DictationError::new(ErrorCode::MicUnavailable, "no input device"))?;
        let config = device
            .default_input_config()
            .map_err(|e| DictationError::new(ErrorCode::MicUnavailable, e.to_string()))?;
        let rate: u32 = config.sample_rate();
        let channels = config.channels() as usize;
        let err_tx = tx.clone();
        let on_error = move |e: cpal::Error| {
            let _ = err_tx.send(CaptureMsg::Failed(e.to_string()));
        };
        let stream_config: cpal::StreamConfig = config.into();
        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => device.build_input_stream(
                stream_config,
                move |data: &[f32], _| {
                    let _ = tx.send(CaptureMsg::Samples(
                        data.chunks(channels)
                            .map(|f| f.iter().sum::<f32>() / channels as f32)
                            .collect(),
                    ));
                },
                on_error,
                None,
            ),
            cpal::SampleFormat::I16 => device.build_input_stream(
                stream_config,
                move |data: &[i16], _| {
                    let _ = tx.send(CaptureMsg::Samples(
                        data.chunks(channels)
                            .map(|f| {
                                f.iter().map(|s| *s as f32 / 32768.0).sum::<f32>() / channels as f32
                            })
                            .collect(),
                    ));
                },
                on_error,
                None,
            ),
            other => {
                return Err(DictationError::new(
                    ErrorCode::MicUnavailable,
                    format!("sample format {other:?}"),
                ))
            }
        }
        .map_err(|e| DictationError::new(ErrorCode::MicUnavailable, e.to_string()))?;
        stream
            .play()
            .map_err(|e| DictationError::new(ErrorCode::MicUnavailable, e.to_string()))?;
        Ok((Capture { _stream: stream }, rate))
    }
}
