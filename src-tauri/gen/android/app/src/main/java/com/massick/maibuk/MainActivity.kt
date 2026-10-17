package com.massick.maibuk

import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import com.jakewharton.processphoenix.ProcessPhoenix
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  // Set once a renderer death has been handled for the current WebView, so a
  // death is logged once. Reset in onWebViewCreate, because recreate() builds
  // a new WebView for the next death.
  private var rendererGoneHandled = false

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    rendererGoneHandled = false
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
  // app start route.
  private fun handleRendererGone(view: WebView, detail: RenderProcessGoneDetail) {
    if (rendererGoneHandled) return
    rendererGoneHandled = true
    Log.e("Maibuk", describeRenderProcessGone(detail.didCrash(), detail.rendererPriorityAtExit()))
    (view.parent as? ViewGroup)?.removeView(view)
    view.destroy()
    ProcessPhoenix.triggerRebirth(this)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

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
