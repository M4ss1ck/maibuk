package com.massick.maibuk

import org.junit.Assert.assertEquals
import org.junit.Test

class RenderProcessGoneTest {
    @Test
    fun describesCrash() {
        assertEquals(
            "WebView renderer gone: crashed (priority=5)",
            describeRenderProcessGone(didCrash = true, priorityAtExit = 5),
        )
    }

    @Test
    fun describesSystemKill() {
        assertEquals(
            "WebView renderer gone: killed by system (priority=2)",
            describeRenderProcessGone(didCrash = false, priorityAtExit = 2),
        )
    }
}
