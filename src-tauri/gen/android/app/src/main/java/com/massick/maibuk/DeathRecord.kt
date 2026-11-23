package com.massick.maibuk

import android.webkit.JavascriptInterface

const val DEATH_RECORD_PREFS = "maibuk_renderer_death"
const val DEATH_RECORD_KEY = "last"

/**
 * What the app knew when the WebView renderer died, written to
 * SharedPreferences before the process restarts or exits (#926). Hand-written
 * JSON because org.json is stubbed in JVM unit tests.
 */
data class DeathRecord(
  val at: Long,
  val didCrash: Boolean,
  val rendererPriorityAtExit: Int,
  val foreground: Boolean,
  val plugins: List<PluginActivityEntry>,
  val appVersion: String,
  val androidVersion: String,
  val webViewVersion: String,
) {
  fun toJson(): String = buildString {
    append("{\"at\":").append(at)
    append(",\"didCrash\":").append(didCrash)
    append(",\"rendererPriorityAtExit\":").append(rendererPriorityAtExit)
    append(",\"foreground\":").append(foreground)
    append(",\"plugins\":[")
    plugins.forEachIndexed { index, plugin ->
      if (index > 0) append(',')
      append("{\"pluginId\":").append(jsonString(plugin.pluginId))
      append(",\"version\":").append(jsonString(plugin.version))
      append(",\"lastActivityAt\":").append(plugin.lastActivityAt)
      append('}')
    }
    append("],\"appVersion\":").append(jsonString(appVersion))
    append(",\"androidVersion\":").append(jsonString(androidVersion))
    append(",\"webViewVersion\":").append(jsonString(webViewVersion))
    append('}')
  }
}

/**
 * Saves the record synchronously, then rebirths when the app was visible or
 * exits quietly when it was not. The save always runs first: a rebirth kills
 * the process, so a later write would never happen.
 */
fun handleRendererDeath(
  record: DeathRecord,
  save: (String) -> Unit,
  rebirth: () -> Unit,
  quietExit: () -> Unit,
) {
  save(record.toJson())
  if (record.foreground) rebirth() else quietExit()
}

private fun jsonString(value: String): String = buildString {
  append('"')
  for (c in value) {
    when {
      c == '\\' -> append("\\\\")
      c == '"' -> append("\\\"")
      c == '\n' -> append("\\n")
      c == '\r' -> append("\\r")
      c == '\t' -> append("\\t")
      c < ' ' -> append("\\u%04x".format(c.code))
      else -> append(c)
    }
  }
  append('"')
}

/**
 * Hands the page the saved death record once, then clears it, so the next
 * launch does not answer the same death again (#927).
 */
class DeathRecordBridge(
  private val read: () -> String?,
  private val clear: () -> Unit,
) {
  @JavascriptInterface
  @Synchronized
  fun take(): String? {
    val record = read() ?: return null
    clear()
    return record
  }
}
