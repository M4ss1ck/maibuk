// Exact timing for scheduled System Notifications (ADR 0042, #870).
//
// From Android 12 an alarm fires on time only when the author allows "Alarms &
// reminders" (SCHEDULE_EXACT_ALARM); without it the notification plugin falls
// back to inexact scheduling, which can fire minutes late. Maibuk never
// declares USE_EXACT_ALARM, which Play keeps for alarm-clock apps. Every other
// platform keeps its own deadlines on a host timer, so it reports exact.

/// Whether a scheduled System Notification fires on time on this device.
#[tauri::command]
pub fn exact_alarms_allowed() -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        android::allowed()
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(true)
    }
}

/// Opens Android's "Alarms & reminders" page for Maibuk; a no-op elsewhere and
/// before Android 12, where exact alarms need no grant.
#[tauri::command]
pub fn request_exact_alarms() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android::request()
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(())
    }
}

#[cfg(target_os = "android")]
mod android {
    use jni::objects::{JObject, JString, JValue};
    use jni::JNIEnv;

    /// Android 12 (S), the first release that gates exact alarms.
    const ANDROID_S: i32 = 31;

    /// Runs `f` with the JNI env and the activity. A thrown Java exception is
    /// cleared before returning, so it never stays pending on this thread.
    fn with_activity<T>(
        f: impl FnOnce(&mut JNIEnv, &JObject) -> jni::errors::Result<T>,
    ) -> Result<T, String> {
        let ctx = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| e.to_string())?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let activity = unsafe { JObject::from_raw(ctx.context().cast()) };
        let result = f(&mut env, &activity);
        if result.is_err() && env.exception_check().unwrap_or(false) {
            let _ = env.exception_clear();
        }
        result.map_err(|e| e.to_string())
    }

    fn sdk_int(env: &mut JNIEnv) -> jni::errors::Result<i32> {
        env.get_static_field("android/os/Build$VERSION", "SDK_INT", "I")?
            .i()
    }

    pub fn allowed() -> Result<bool, String> {
        with_activity(|env, activity| {
            if sdk_int(env)? < ANDROID_S {
                return Ok(true);
            }
            let name = env.new_string("alarm")?;
            let manager = env
                .call_method(
                    activity,
                    "getSystemService",
                    "(Ljava/lang/String;)Ljava/lang/Object;",
                    &[JValue::Object(&name)],
                )?
                .l()?;
            env.call_method(&manager, "canScheduleExactAlarms", "()Z", &[])?
                .z()
        })
    }

    pub fn request() -> Result<(), String> {
        with_activity(|env, activity| {
            if sdk_int(env)? < ANDROID_S {
                return Ok(());
            }
            let package = env
                .call_method(activity, "getPackageName", "()Ljava/lang/String;", &[])?
                .l()?;
            let package: String = env.get_string(&JString::from(package))?.into();
            let uri_text = env.new_string(format!("package:{package}"))?;
            let uri = env
                .call_static_method(
                    "android/net/Uri",
                    "parse",
                    "(Ljava/lang/String;)Landroid/net/Uri;",
                    &[JValue::Object(&uri_text)],
                )?
                .l()?;
            let action = env.new_string("android.settings.REQUEST_SCHEDULE_EXACT_ALARM")?;
            let intent = env.new_object(
                "android/content/Intent",
                "(Ljava/lang/String;Landroid/net/Uri;)V",
                &[JValue::Object(&action), JValue::Object(&uri)],
            )?;
            env.call_method(
                activity,
                "startActivity",
                "(Landroid/content/Intent;)V",
                &[JValue::Object(&intent)],
            )?;
            Ok(())
        })
    }
}
