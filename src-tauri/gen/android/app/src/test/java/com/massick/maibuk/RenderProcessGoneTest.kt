package com.massick.maibuk

import android.graphics.Bitmap
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Records every call it receives. Android stubs are no-ops under
 * `isReturnDefaultValues`, so the WebView and detail objects are only used
 * for identity checks.
 */
private class RecordingDelegate : WebViewClient() {
    val calls = mutableListOf<String>()
    var lastView: WebView? = null
    var lastRequest: WebResourceRequest? = null
    var overrideResult = true
    var interceptResult: WebResourceResponse? = null

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        calls += "shouldOverrideUrlLoading"
        lastView = view
        lastRequest = request
        return overrideResult
    }

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        calls += "shouldInterceptRequest"
        lastView = view
        lastRequest = request
        return interceptResult
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        calls += "onPageStarted:$url"
        lastView = view
    }

    override fun onPageFinished(view: WebView, url: String) {
        calls += "onPageFinished:$url"
        lastView = view
    }
}

/** Kotlin rejects a null Context literal, so construct via reflection (stub ctor is a no-op). */
private fun newWebView(): WebView =
    WebView::class.java.getDeclaredConstructor(android.content.Context::class.java)
        .apply { isAccessible = true }
        .newInstance(null)

private fun fakeDetail() = object : RenderProcessGoneDetail() {
    override fun didCrash(): Boolean = true
    override fun rendererPriorityAtExit(): Int = 5
}

private fun fakeRequest() = object : WebResourceRequest {
    override fun getUrl(): android.net.Uri? = null
    override fun isForMainFrame(): Boolean = true
    override fun isRedirect(): Boolean = false
    override fun hasGesture(): Boolean = false
    override fun getMethod(): String = "GET"
    override fun getRequestHeaders(): MutableMap<String, String> = mutableMapOf()
}

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

    @Test
    fun rendererGoneInvokesOnGoneOnceWithSameViewAndReturnsTrue() {
        val view = newWebView()
        val detail = fakeDetail()
        val delegate = RecordingDelegate()
        var goneCalls = 0
        var seenView: WebView? = null
        var seenDetail: RenderProcessGoneDetail? = null
        val client = RenderProcessGoneClient(delegate) { v, d ->
            goneCalls++
            seenView = v
            seenDetail = d
        }

        val handled = client.onRenderProcessGone(view, detail)

        assertTrue(handled)
        assertEquals(1, goneCalls)
        assertSame(view, seenView)
        assertSame(detail, seenDetail)
        assertTrue("renderer-gone must not reach the delegate", delegate.calls.isEmpty())
    }

    @Test
    fun shouldOverrideUrlLoadingForwardsArgsAndReturnsDelegateValue() {
        val view = newWebView()
        val request = fakeRequest()
        val delegate = RecordingDelegate().apply { overrideResult = false }
        val client = RenderProcessGoneClient(delegate) { _, _ -> error("unexpected") }

        assertEquals(false, client.shouldOverrideUrlLoading(view, request))
        assertEquals(listOf("shouldOverrideUrlLoading"), delegate.calls)
        assertSame(view, delegate.lastView)
        assertSame(request, delegate.lastRequest)
    }

    @Test
    fun shouldInterceptRequestForwardsArgsAndReturnsDelegateValue() {
        val view = newWebView()
        val request = fakeRequest()
        val response = WebResourceResponse("text/plain", "utf-8", null)
        val delegate = RecordingDelegate().apply { interceptResult = response }
        val client = RenderProcessGoneClient(delegate) { _, _ -> error("unexpected") }

        assertSame(response, client.shouldInterceptRequest(view, request))
        assertEquals(listOf("shouldInterceptRequest"), delegate.calls)
        assertSame(request, delegate.lastRequest)
    }

    @Test
    fun pageLifecycleCallbacksForwardToDelegate() {
        val view = newWebView()
        val delegate = RecordingDelegate()
        val client = RenderProcessGoneClient(delegate) { _, _ -> error("unexpected") }

        client.onPageStarted(view, "https://a.test/", null)
        client.onPageFinished(view, "https://a.test/")

        assertEquals(
            listOf("onPageStarted:https://a.test/", "onPageFinished:https://a.test/"),
            delegate.calls,
        )
        assertSame(view, delegate.lastView)
    }
}
