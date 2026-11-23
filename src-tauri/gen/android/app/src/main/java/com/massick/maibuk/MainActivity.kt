package com.massick.maibuk

import android.content.Intent
import android.os.Bundle
import android.os.Process
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import com.jakewharton.processphoenix.ProcessPhoenix
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  // Set once a renderer death has been handled, so each death is logged and
  // acted on once even if Chromium reports it again before the restart.
  private var rendererGoneHandled = false

  // The notification plugin's tap event names no notification, and a cold-start
  // tap fires before any page listens, so the tapped id waits here until the
  // page takes it (#870).
  private val notificationTaps = NotificationTaps()
  private var webView: WebView? = null

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    rendererGoneHandled = false
    this.webView = webView
    // Added before wry loads the page, so the page sees it from the start.
    webView.addJavascriptInterface(notificationTaps, "MaibukNotificationTaps")
    // wry calls setWebView (this callback) before it calls setWebViewClient, so
    // wrapping here would be overwritten. Posting runs after wry's synchronous
    // setup on the main thread.
    webView.post {
      if (webView.webViewClient !is RenderProcessGoneClient) {
        webView.webViewClient =
          RenderProcessGoneClient(webView.webViewClient) { view, detail ->
            handleRendererGone(view, detail)
          }
      }
    }
  }

  // Chromium kills the whole app when a renderer dies unless onRenderProcessGone
  // returns true. Returning true keeps the process alive, but the dead WebView
  // cannot be reused, so we restart the process (#518).
  //
  // recreate() is not an option: the activity teardown crashes wry's native
  // state with "FORTIFY: pthread_mutex_lock called on a destroyed mutex" on the
  // render thread, which kills the process. ProcessPhoenix kills this process
  // and relaunches the launcher activity, which builds a fresh WebView on the
  // app start route. In the background there is nothing to show, so the process
  // exits quietly instead (#924).
  private fun handleRendererGone(view: WebView, detail: RenderProcessGoneDetail) {
    if (rendererGoneHandled) return
    rendererGoneHandled = true
    Log.e("Maibuk", describeRenderProcessGone(detail.didCrash(), detail.rendererPriorityAtExit()))
    (view.parent as? ViewGroup)?.removeView(view)
    view.destroy()
    when (rendererGoneAction(lifecycle.currentState)) {
      RendererGoneAction.Rebirth -> ProcessPhoenix.triggerRebirth(this)
      RendererGoneAction.QuietExit -> {
        finishAndRemoveTask()
        Process.killProcess(Process.myPid())
      }
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    if (notificationTaps.record(intent)) {
      webView?.evaluateJavascript(
        "window.dispatchEvent(new Event('maibuk:notification-tap'))",
        null,
      )
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    notificationTaps.record(intent)

    // WebView builds before M136/M139 ignore env(safe-area-inset-*) and IME
    // resize, so inset the native content root ourselves and return a builder
    // with those same inset types zeroed to keep modern WebView from
    // double-handling them.
    val contentRoot = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(contentRoot) { view, windowInsets ->
      val types =
        WindowInsetsCompat.Type.systemBars() or
          WindowInsetsCompat.Type.displayCutout() or
          WindowInsetsCompat.Type.ime()
      val insets = windowInsets.getInsets(types)
      view.setPadding(insets.left, insets.top, insets.right, insets.bottom)
      WindowInsetsCompat.Builder(windowInsets)
        .setInsets(types, Insets.NONE)
        .build()
    }
    ViewCompat.requestApplyInsets(contentRoot)
  }
}

/** The id of the last notification the author tapped, for the page to take once. */
class NotificationTaps {
  @Volatile private var tapped = -1

  /** Keeps the tapped id when the intent came from a notification. */
  fun record(intent: Intent?): Boolean {
    // The notification plugin's key for the id on its tap intent.
    val id = intent?.getIntExtra("NotificationId", Int.MIN_VALUE) ?: Int.MIN_VALUE
    if (id == Int.MIN_VALUE) return false
    tapped = id
    return true
  }

  @JavascriptInterface
  fun take(): Int {
    val id = tapped
    tapped = -1
    return id
  }
}
