package com.massick.maibuk

import android.app.Activity
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.InputStream

@InvokeArg
class PickDocumentArgs {
  var extensions: Array<String> = arrayOf()
}

@InvokeArg
class DocumentArgs {
  lateinit var uri: String
}

/**
 * The MIME types the document picker filters to for a Plugin's extensions. An
 * extension the platform cannot name a type for adds `application/octet-stream`,
 * the type providers report for such a file: Android 8 names none for `cbz`,
 * and without it the picker greys every comic out. The filter goes away only
 * when no extension names a type at all, since then nothing would be left to
 * filter by. Rust validated the extensions' shape before they got here.
 */
fun pickerMimeTypes(extensions: List<String>, lookup: (String) -> String?): List<String> {
  val types = extensions.map { lookup(it) ?: GENERIC_MIME_TYPE }.distinct()
  return if (types.all { it == GENERIC_MIME_TYPE }) emptyList() else types
}

private const val GENERIC_MIME_TYPE = "application/octet-stream"

/**
 * The size a description carries: the column the provider filled, else the
 * descriptor's stat, else, on a pick (`measure`), the bytes counted off the
 * content stream. `descriptor` is not asked when the column answers, since
 * opening one is a round trip to the provider, and `count` is not asked on a
 * stat, which leaves a size nobody reports unknown rather than downloading the
 * whole document to learn it.
 */
fun documentSize(
  column: Long?,
  descriptor: () -> Long?,
  count: () -> Long?,
  measure: Boolean,
): Long? {
  if (column != null && column >= 0) return column
  val statSize = descriptor()
  if (statSize != null && statSize >= 0) return statSize
  return if (measure) count() else null
}

/**
 * A document's size counted off its stream, for a provider that reports none.
 * The caller owns `stream`; this does not close it.
 */
fun countBytes(stream: InputStream): Long {
  val buffer = ByteArray(64 * 1024)
  var total = 0L
  while (true) {
    val read = stream.read(buffer)
    if (read < 0) return total
    total += read
  }
}

/**
 * The Kotlin half of File Grants on Android (ADR 0036; Rust side in
 * src-tauri/src/plugins/files.rs, `mod android`). It opens the system document
 * picker with ACTION_OPEN_DOCUMENT, whose read permission can be persisted, so
 * a Plugin's Shelf still opens the document after a restart; ACTION_GET_CONTENT,
 * which the dialog plugin uses, loses it with the process. The URI goes to Rust
 * only, never to the webview, and the bytes are read in Rust through the fs
 * plugin's content resolver open, so nothing here carries file contents.
 */
@TauriPlugin
class FileGrantsPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun pick(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(PickDocumentArgs::class.java)
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "*/*"
        val types = pickerMimeTypes(args.extensions.toList()) {
          MimeTypeMap.getSingleton().getMimeTypeFromExtension(it)
        }
        if (types.isNotEmpty()) putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
      }
      startActivityForResult(invoke, intent, "pickResult")
    } catch (error: Exception) {
      invoke.reject(error.message ?: "The document picker could not open")
    }
  }

  @ActivityCallback
  fun pickResult(invoke: Invoke, result: ActivityResult) {
    val uri = result.data?.data
    // A cancel resolves with no URI, the same way the desktop dialog does.
    if (result.resultCode != Activity.RESULT_OK || uri == null) {
      invoke.resolve(JSObject())
      return
    }
    // A provider that offers no persistable permission still reads for this
    // run; the grant then reads as gone after a restart.
    try {
      activity.contentResolver.takePersistableUriPermission(
        uri,
        Intent.FLAG_GRANT_READ_URI_PERMISSION,
      )
    } catch (_: SecurityException) {}
    try {
      val document = describe(uri, measure = true)
      val answer = JSObject()
      answer.put("uri", uri.toString())
      answer.put("name", document.name)
      // A pick always names a size: describe measured one or failed here.
      answer.put(
        "size",
        requireNotNull(document.size) {
          "This document does not report its size and cannot be read to measure it"
        },
      )
      invoke.resolve(answer)
    } catch (error: Exception) {
      // Rust hears nothing about this URI, so no grant, release, or clear can
      // ever give the permission this pick took back: hand it back here.
      releasePermission(uri)
      invoke.reject(error.message ?: "The picked document is unreadable")
    }
  }

  /** Name, size, and last-modified time; rejects a document that is gone. */
  @Command
  fun stat(invoke: Invoke) {
    try {
      val uri = Uri.parse(invoke.parseArgs(DocumentArgs::class.java).uri)
      val document = describe(uri, measure = false)
      val answer = JSObject()
      answer.put("name", document.name)
      // A provider that reports no size leaves it out, so Rust keeps the size
      // the pick recorded instead of calling a real document empty.
      document.size?.let { answer.put("size", it) }
      answer.put("modified", document.modified)
      invoke.resolve(answer)
    } catch (error: Exception) {
      invoke.reject(error.message ?: "The document is gone or unreadable")
    }
  }

  /** Gives the persisted read permission back; one already gone is fine. */
  @Command
  fun release(invoke: Invoke) {
    try {
      releasePermission(Uri.parse(invoke.parseArgs(DocumentArgs::class.java).uri))
    } catch (_: Exception) {}
    invoke.resolve()
  }

  /** Hands the read permission the system holds for `uri` back to the system. */
  private fun releasePermission(uri: Uri) {
    try {
      activity.contentResolver.releasePersistableUriPermission(
        uri,
        Intent.FLAG_GRANT_READ_URI_PERMISSION,
      )
    } catch (_: Exception) {}
  }

  private class Document(val name: String, val size: Long?, val modified: Long)

  /**
   * Reads the document's columns. A null or empty cursor, and the
   * SecurityException a revoked permission raises, mean the document is gone.
   * A pick (`measure`) settles the size, counting the bytes when the provider
   * reports none at all; a stat leaves a size nobody reports unknown, which
   * Rust fills from the size the pick recorded. A pick whose size cannot be
   * learned is an error, never 0, because a 0-byte grant cannot be opened and
   * fingerprints like an empty file.
   */
  private fun describe(uri: Uri, measure: Boolean): Document {
    val cursor = activity.contentResolver.query(uri, null, null, null, null)
      ?: throw IllegalStateException("The document is gone")
    cursor.use {
      if (!it.moveToFirst()) throw IllegalStateException("The document is gone")
      val name = it.text(OpenableColumns.DISPLAY_NAME) ?: uri.lastPathSegment ?: ""
      val size = documentSize(
        it.number(OpenableColumns.SIZE),
        { descriptorSize(uri) },
        { countStream(uri) },
        measure,
      )
      val modified = it.number(DocumentsContract.Document.COLUMN_LAST_MODIFIED) ?: 0L
      return Document(name, size, modified)
    }
  }

  /** The open descriptor's stat size; -1 when the provider offers none. */
  private fun descriptorSize(uri: Uri): Long = try {
    activity.contentResolver.openFileDescriptor(uri, "r")?.use { it.statSize } ?: -1L
  } catch (_: Exception) {
    -1L
  }

  /** The document's bytes counted off its stream; `null` when it cannot be read. */
  private fun countStream(uri: Uri): Long? = try {
    activity.contentResolver.openInputStream(uri)?.use { countBytes(it) }
  } catch (_: Exception) {
    null
  }

  private fun Cursor.text(column: String): String? {
    val index = getColumnIndex(column)
    return if (index < 0 || isNull(index)) null else getString(index)
  }

  private fun Cursor.number(column: String): Long? {
    val index = getColumnIndex(column)
    return if (index < 0 || isNull(index)) null else getLong(index)
  }
}
