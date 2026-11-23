package com.massick.maibuk

import android.webkit.JavascriptInterface
import java.util.concurrent.ConcurrentHashMap

/** One Plugin's latest activity in the renderer, taken for a death record. */
data class PluginActivityEntry(
  val pluginId: String,
  val version: String,
  val lastActivityAt: Long,
)

/**
 * Each running Plugin's last activity (a call, a host request, an open page
 * or Frame), keyed by Plugin id, so a renderer death can say which Plugins
 * were active (#926). The page reports through [report], throttled per Plugin.
 */
class PluginActivity {
  private val entries = ConcurrentHashMap<String, PluginActivityEntry>()

  @JavascriptInterface
  fun report(pluginId: String, version: String, at: Double) {
    entries[pluginId] = PluginActivityEntry(pluginId, version, at.toLong())
  }

  fun snapshot(): List<PluginActivityEntry> = entries.values.sortedBy { it.pluginId }
}
