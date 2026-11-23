package com.massick.maibuk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeathRecordTest {
  private fun record(
    foreground: Boolean,
    didCrash: Boolean = true,
    appVersion: String = "2.4.0",
  ) = DeathRecord(
    at = 1_700_000_000_000,
    didCrash = didCrash,
    rendererPriorityAtExit = 5,
    foreground = foreground,
    plugins = listOf(
      PluginActivityEntry("notes", "1.2.0", 1_699_999_999_000),
      PluginActivityEntry("shelf", "0.3.1", 1_699_999_999_500),
    ),
    appVersion = appVersion,
    androidVersion = "14 (API 34)",
    webViewVersion = "126.0.6478.71",
  )

  @Test
  fun foregroundRecordIsSavedBeforeRebirth() {
    val events = mutableListOf<String>()
    var saved: String? = null

    handleRendererDeath(
      record(foreground = true),
      save = {
        events += "save"
        saved = it
      },
      rebirth = { events += "rebirth" },
      quietExit = { events += "quietExit" },
    )

    assertEquals(listOf("save", "rebirth"), events)
    val json = saved ?: error("no record saved")
    for (fragment in listOf(
      "\"at\":1700000000000",
      "\"didCrash\":true",
      "\"rendererPriorityAtExit\":5",
      "\"foreground\":true",
      "\"pluginId\":\"notes\"",
      "\"version\":\"1.2.0\"",
      "\"lastActivityAt\":1699999999000",
      "\"pluginId\":\"shelf\"",
      "\"appVersion\":\"2.4.0\"",
      "\"androidVersion\":\"14 (API 34)\"",
      "\"webViewVersion\":\"126.0.6478.71\"",
    )) {
      assertTrue("missing $fragment in $json", json.contains(fragment))
    }
  }

  @Test
  fun backgroundRecordIsSavedBeforeQuietExit() {
    val events = mutableListOf<String>()
    var saved: String? = null

    handleRendererDeath(
      record(foreground = false, didCrash = false),
      save = {
        events += "save"
        saved = it
      },
      rebirth = { events += "rebirth" },
      quietExit = { events += "quietExit" },
    )

    assertEquals(listOf("save", "quietExit"), events)
    val json = saved ?: error("no record saved")
    assertTrue("missing \"foreground\":false in $json", json.contains("\"foreground\":false"))
    assertTrue("missing \"didCrash\":false in $json", json.contains("\"didCrash\":false"))
  }

  @Test
  fun jsonEscapesQuotesAndBackslashes() {
    val json = record(foreground = true, appVersion = "a\"b\\c").toJson()

    assertTrue(json.contains("\"appVersion\":\"a\\\"b\\\\c\""))
    assertFalse(json.contains("a\"b"))
  }

  @Test
  fun reportOverwritesSamePluginAndSnapshotReturnsLatestPerPlugin() {
    val activity = PluginActivity()
    activity.report("shelf", "0.3.0", 10.0)
    activity.report("notes", "1.0.0", 20.0)
    activity.report("shelf", "0.3.1", 30.0)

    assertEquals(
      listOf(
        PluginActivityEntry("notes", "1.0.0", 20L),
        PluginActivityEntry("shelf", "0.3.1", 30L),
      ),
      activity.snapshot(),
    )
  }
}
