package com.massick.maibuk

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
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
