// Exiting via std::process::exit tears down EGL through __cxa_finalize and can
// abort (SIGABRT on a destroyed mutex) on Android. Finishing the activity lets
// it shut down normally and fires visibilitychange so pending work can flush.
#[tauri::command]
pub fn exit_app(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let _ = app;
        finish_activity()
    }
    #[cfg(not(target_os = "android"))]
    {
        app.exit(0);
        Ok(())
    }
}

#[cfg(target_os = "android")]
fn finish_activity() -> Result<(), String> {
    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| e.to_string())?;
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
    let activity = unsafe { jni::objects::JObject::from_raw(ctx.context().cast()) };
    env.call_method(&activity, "finish", "()V", &[])
        .map_err(|e| e.to_string())?;
    Ok(())
}
