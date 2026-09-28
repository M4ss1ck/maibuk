use crate::dictation::protocol::{
    DictationError, ErrorCode, HostMessage, ModelSpec, SupportReport,
};
use tauri::ipc::Channel;

#[cfg(target_os = "linux")]
mod imp {
    use super::*;
    use crate::dictation::engine::{create_engine, moonshine_ffi};
    use crate::dictation::models;
    use crate::dictation::runner::{Microphone, Runner, SharedEngine};
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use tauri::{AppHandle, Manager, State};

    #[derive(Default)]
    pub struct DictationState {
        loaded: Mutex<Option<(String, SharedEngine)>>,
        running: Mutex<Option<Runner>>,
        /// The channel of the last start, so a stop with no runner (it ended on
        /// an error) still sends `stopped` and the TS host's stop() resolves.
        last_channel: Mutex<Option<Channel<HostMessage>>>,
        cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
    }

    fn base(app: &AppHandle) -> Result<PathBuf, DictationError> {
        app.path()
            .app_data_dir()
            .map_err(|e| DictationError::new(ErrorCode::DownloadFailed, e.to_string()))
    }

    #[tauri::command]
    pub fn dictation_is_supported() -> SupportReport {
        match moonshine_ffi::api() {
            Ok(_) => SupportReport {
                supported: true,
                reason: None,
            },
            Err(_) => SupportReport {
                supported: false,
                reason: Some("library_missing"),
            },
        }
    }

    #[tauri::command]
    pub async fn dictation_load(
        app: AppHandle,
        state: State<'_, DictationState>,
        spec: ModelSpec,
    ) -> Result<(), DictationError> {
        if state
            .loaded
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|(id, _)| *id == spec.id)
        {
            return Ok(());
        }
        let base = base(&app)?;
        let id = spec.id.clone();
        let engine = tauri::async_runtime::spawn_blocking(
            move || -> Result<SharedEngine, DictationError> {
                let dir = models::verify(&base, &spec)?;
                let mut engine = create_engine(&spec)?;
                engine.load(&dir, &spec)?;
                Ok(Arc::new(Mutex::new(engine)))
            },
        )
        .await
        .map_err(|e| DictationError::new(ErrorCode::EngineCrashed, e.to_string()))??;
        *state.loaded.lock().unwrap() = Some((id, engine));
        Ok(())
    }

    #[tauri::command]
    pub async fn dictation_start(
        state: State<'_, DictationState>,
        on_event: Channel<HostMessage>,
    ) -> Result<(), DictationError> {
        let engine = state
            .loaded
            .lock()
            .unwrap()
            .as_ref()
            .map(|(_, e)| e.clone())
            .ok_or_else(|| DictationError::new(ErrorCode::ModelMissing, "load first"))?;
        let old = state.running.lock().unwrap().take();
        if let Some(old) = old {
            tauri::async_runtime::spawn_blocking(move || old.stop())
                .await
                .map_err(|e| DictationError::new(ErrorCode::EngineCrashed, e.to_string()))?;
        }
        engine.lock().unwrap().start()?;
        let channel = on_event.clone();
        let runner = Runner::spawn(engine, Microphone::new(), move |message| {
            let _ = channel.send(message);
        })?;
        *state.running.lock().unwrap() = Some(runner);
        *state.last_channel.lock().unwrap() = Some(on_event);
        Ok(())
    }

    #[tauri::command]
    pub async fn dictation_stop(state: State<'_, DictationState>) -> Result<(), DictationError> {
        let taken = state.running.lock().unwrap().take();
        match taken {
            // Runner::stop joins after the final events and `Stopped` were sent.
            Some(runner) => tauri::async_runtime::spawn_blocking(move || runner.stop())
                .await
                .map_err(|e| DictationError::new(ErrorCode::EngineCrashed, e.to_string())),
            None => {
                if let Some(channel) = state.last_channel.lock().unwrap().take() {
                    let _ = channel.send(HostMessage::Stopped);
                }
                Ok(())
            }
        }
    }

    #[tauri::command]
    pub fn dictation_set_context(state: State<'_, DictationState>, text: String) {
        if let Some((_, engine)) = state.loaded.lock().unwrap().as_ref() {
            engine.lock().unwrap().set_context(&text);
        }
    }

    #[tauri::command]
    pub fn dictation_input_device() -> Option<String> {
        use cpal::traits::{DeviceTrait, HostTrait};
        let device = cpal::default_host().default_input_device()?;
        device.description().ok().map(|d| d.name().to_string())
    }

    #[tauri::command]
    pub async fn dictation_unload(state: State<'_, DictationState>) -> Result<(), DictationError> {
        let runner = state.running.lock().unwrap().take();
        if let Some(runner) = runner {
            tauri::async_runtime::spawn_blocking(move || runner.stop())
                .await
                .map_err(|e| DictationError::new(ErrorCode::EngineCrashed, e.to_string()))?;
        }
        *state.loaded.lock().unwrap() = None;
        *state.last_channel.lock().unwrap() = None;
        Ok(())
    }

    #[tauri::command]
    pub async fn dictation_models_install(
        app: AppHandle,
        state: State<'_, DictationState>,
        spec: ModelSpec,
        on_progress: Channel<(u64, u64)>,
    ) -> Result<(), DictationError> {
        let base = base(&app)?;
        let cancel = Arc::new(AtomicBool::new(false));
        state
            .cancels
            .lock()
            .unwrap()
            .insert(spec.id.clone(), cancel.clone());
        let id = spec.id.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            let mut last = std::time::Instant::now();
            models::install(&base, &spec, &cancel, &mut |done, total| {
                // Throttle to ~10 updates a second; the final one always goes out.
                if done == total || last.elapsed().as_millis() >= 100 {
                    last = std::time::Instant::now();
                    let _ = on_progress.send((done, total));
                }
            })
        })
        .await;
        state.cancels.lock().unwrap().remove(&id);
        result.map_err(|e| DictationError::new(ErrorCode::DownloadFailed, e.to_string()))?
    }

    #[tauri::command]
    pub fn dictation_models_cancel(state: State<'_, DictationState>, id: String) {
        if let Some(flag) = state.cancels.lock().unwrap().get(&id) {
            flag.store(true, Ordering::Relaxed);
        }
    }

    #[tauri::command]
    pub fn dictation_models_is_complete(app: AppHandle, spec: ModelSpec) -> bool {
        base(&app)
            .map(|b| models::is_complete(&b, &spec))
            .unwrap_or(false)
    }

    #[tauri::command]
    pub fn dictation_models_remove(
        app: AppHandle,
        state: State<'_, DictationState>,
        id: String,
    ) -> Result<(), DictationError> {
        {
            let mut loaded = state.loaded.lock().unwrap();
            if loaded
                .as_ref()
                .is_some_and(|(loaded_id, _)| *loaded_id == id)
            {
                *loaded = None;
            }
        }
        models::remove(&base(&app)?, &id)
    }
}

#[cfg(not(target_os = "linux"))]
mod imp {
    use super::*;

    #[derive(Default)]
    pub struct DictationState;

    fn unsupported() -> DictationError {
        DictationError::code(ErrorCode::Unsupported)
    }

    #[tauri::command]
    pub fn dictation_is_supported() -> SupportReport {
        SupportReport {
            supported: false,
            reason: Some("platform"),
        }
    }
    #[tauri::command]
    pub fn dictation_load(spec: ModelSpec) -> Result<(), DictationError> {
        let _ = spec;
        Err(unsupported())
    }
    #[tauri::command]
    pub fn dictation_start(on_event: Channel<HostMessage>) -> Result<(), DictationError> {
        let _ = on_event;
        Err(unsupported())
    }
    #[tauri::command]
    pub fn dictation_stop() {}
    #[tauri::command]
    pub fn dictation_set_context(text: String) {
        let _ = text;
    }
    #[tauri::command]
    pub fn dictation_input_device() -> Option<String> {
        None
    }
    #[tauri::command]
    pub fn dictation_unload() {}
    #[tauri::command]
    pub fn dictation_models_install(
        spec: ModelSpec,
        on_progress: Channel<(u64, u64)>,
    ) -> Result<(), DictationError> {
        let _ = (spec, on_progress);
        Err(unsupported())
    }
    #[tauri::command]
    pub fn dictation_models_cancel(id: String) {
        let _ = id;
    }
    #[tauri::command]
    pub fn dictation_models_is_complete(spec: ModelSpec) -> bool {
        let _ = spec;
        false
    }
    #[tauri::command]
    pub fn dictation_models_remove(id: String) -> Result<(), DictationError> {
        let _ = id;
        Err(unsupported())
    }
}

pub use imp::*;
