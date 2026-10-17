package com.massick.maibuk

import android.graphics.Bitmap
import android.os.Message
import android.view.KeyEvent
import android.webkit.ClientCertRequest
import android.webkit.HttpAuthHandler
import android.webkit.RenderProcessGoneDetail
import android.webkit.SafeBrowsingResponse
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.net.http.SslError

/**
 * Wraps the WebViewClient that wry installs so a dead renderer process is
 * handled here instead of by Chromium's default, which kills the whole app
 * (aw_browser_terminator). Every other callback is forwarded verbatim to
 * [delegate], so wry's request handling is unchanged.
 *
 * Defense in depth for #518 (see also #492): the activity recreates its
 * WebView when [onGone] fires.
 */
class RenderProcessGoneClient(
    private val delegate: WebViewClient,
    private val onGone: (WebView, RenderProcessGoneDetail) -> Unit,
) : WebViewClient() {

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        onGone(view, detail)
        return true
    }

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
        delegate.shouldInterceptRequest(view, request)

    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun shouldInterceptRequest(view: WebView, url: String): WebResourceResponse? =
        delegate.shouldInterceptRequest(view, url)

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
        delegate.shouldOverrideUrlLoading(view, request)

    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
        delegate.shouldOverrideUrlLoading(view, url)

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) =
        delegate.onPageStarted(view, url, favicon)

    override fun onPageFinished(view: WebView, url: String) =
        delegate.onPageFinished(view, url)

    override fun onLoadResource(view: WebView, url: String) =
        delegate.onLoadResource(view, url)

    override fun onPageCommitVisible(view: WebView, url: String) =
        delegate.onPageCommitVisible(view, url)

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) =
        delegate.onReceivedError(view, request, error)

    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onReceivedError(view: WebView, errorCode: Int, description: String, failingUrl: String) =
        delegate.onReceivedError(view, errorCode, description, failingUrl)

    override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) =
        delegate.onReceivedHttpError(view, request, errorResponse)

    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) =
        delegate.onReceivedSslError(view, handler, error)

    override fun onReceivedHttpAuthRequest(view: WebView, handler: HttpAuthHandler, host: String, realm: String) =
        delegate.onReceivedHttpAuthRequest(view, handler, host, realm)

    override fun onReceivedClientCertRequest(view: WebView, request: ClientCertRequest) =
        delegate.onReceivedClientCertRequest(view, request)

    override fun onFormResubmission(view: WebView, dontResend: Message, resend: Message) =
        delegate.onFormResubmission(view, dontResend, resend)

    override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) =
        delegate.doUpdateVisitedHistory(view, url, isReload)

    override fun shouldOverrideKeyEvent(view: WebView, event: KeyEvent): Boolean =
        delegate.shouldOverrideKeyEvent(view, event)

    override fun onUnhandledKeyEvent(view: WebView, event: KeyEvent) =
        delegate.onUnhandledKeyEvent(view, event)

    override fun onScaleChanged(view: WebView, oldScale: Float, newScale: Float) =
        delegate.onScaleChanged(view, oldScale, newScale)

    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onReceivedLoginRequest(view: WebView, realm: String, account: String?, args: String) =
        delegate.onReceivedLoginRequest(view, realm, account, args)

    override fun onSafeBrowsingHit(
        view: WebView,
        request: WebResourceRequest,
        threatType: Int,
        callback: SafeBrowsingResponse,
    ) = delegate.onSafeBrowsingHit(view, request, threatType, callback)

    override fun onTooManyRedirects(view: WebView, cancelMsg: Message, continueMsg: Message) =
        delegate.onTooManyRedirects(view, cancelMsg, continueMsg)
}

/** Log line for a renderer death. Pure so the JVM test can cover both causes. */
fun describeRenderProcessGone(didCrash: Boolean, priorityAtExit: Int): String {
    val cause = if (didCrash) "crashed" else "killed by system"
    return "WebView renderer gone: $cause (priority=$priorityAtExit)"
}
