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
import app.tauri.plugin.JSArray
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
 * Whether a document called `name` has one of `extensions` (lowercase, no dot),
 * ignoring case. A dot file such as `.epub` has no extension, the same as on the
 * desktop, and a name ending in a dot has none either.
 */
fun matchesExtension(name: String, extensions: List<String>): Boolean {
  val dot = name.lastIndexOf('.')
  if (dot <= 0 || dot == name.length - 1) return false
  val extension = name.substring(dot + 1)
  return extensions.any { it.equals(extension, ignoreCase = true) }
}

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

  /**
   * Opens the system folder picker. The extensions are parsed here so a
   * malformed call rejects before the picker opens; `pickFolderResult` parses
   * them again to walk the tree.
   */
  @Command
  fun pickFolder(invoke: Invoke) {
    try {
      invoke.parseArgs(PickDocumentArgs::class.java)
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
      startActivityForResult(invoke, intent, "pickFolderResult")
    } catch (error: Exception) {
      invoke.reject(error.message ?: "The folder picker could not open")
    }
  }

  /**
   * Walks the picked tree and answers with its name and every document under it
   * whose name matches the extensions and whose size is known. The tree's read
   * permission is the one that is persisted; the child documents carry none.
   * The answer always names the tree, even when the walk failed (`error`), and
   * never releases it here: an earlier pick of the same folder may still hold
   * grants under it, which only Rust knows, so Rust releases the tree once no
   * grant needs it.
   */
  @ActivityCallback
  fun pickFolderResult(invoke: Invoke, result: ActivityResult) {
    val treeUri = result.data?.data
    // A cancel resolves with no URI, the same way the file picker does.
    if (result.resultCode != Activity.RESULT_OK || treeUri == null) {
      invoke.resolve(JSObject())
      return
    }
    // A provider that offers no persistable permission still reads for this
    // run; the grants then read as gone after a restart.
    try {
      activity.contentResolver.takePersistableUriPermission(
        treeUri,
        Intent.FLAG_GRANT_READ_URI_PERMISSION,
      )
    } catch (_: SecurityException) {}
    val answer = JSObject()
    answer.put("tree", treeUri.toString())
    try {
      val extensions = invoke.parseArgs(PickDocumentArgs::class.java).extensions.toList()
      val documents = JSArray()
      for (document in walkFolder(treeUri, extensions)) {
        val entry = JSObject()
        entry.put("uri", document.uri.toString())
        entry.put("name", document.name)
        entry.put("size", document.size)
        documents.put(entry)
      }
      answer.put("folder", folderName(treeUri))
      answer.put("documents", documents)
    } catch (error: Exception) {
      // Resolve, not reject: Rust must still hear the tree to decide whether
      // its permission goes back.
      answer.put("error", error.message ?: "The picked folder is unreadable")
    }
    invoke.resolve(answer)
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

  private class FolderDocument(val uri: Uri, val name: String, val size: Long)

  /**
   * Every document under the tree's root, in any subfolder, that matches
   * `extensions` and reports a size. Iterative: a pending stack of folder ids,
   * so a deep tree cannot exhaust the call stack.
   */
  private fun walkFolder(treeUri: Uri, extensions: List<String>): List<FolderDocument> {
    val found = mutableListOf<FolderDocument>()
    val pending = ArrayDeque<String>()
    pending.add(DocumentsContract.getTreeDocumentId(treeUri))
    val columns = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
      DocumentsContract.Document.COLUMN_SIZE,
    )
    while (pending.isNotEmpty()) {
      val folderId = pending.removeLast()
      val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, folderId)
      val cursor = activity.contentResolver.query(childrenUri, columns, null, null, null)
        ?: continue
      cursor.use {
        while (it.moveToNext()) {
          val docId = it.text(DocumentsContract.Document.COLUMN_DOCUMENT_ID) ?: continue
          val mime = it.text(DocumentsContract.Document.COLUMN_MIME_TYPE)
          if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
            pending.add(docId)
            continue
          }
          val name = it.text(DocumentsContract.Document.COLUMN_DISPLAY_NAME) ?: continue
          val size = it.number(DocumentsContract.Document.COLUMN_SIZE) ?: continue
          if (size < 0 || !matchesExtension(name, extensions)) continue
          val uri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId)
          found.add(FolderDocument(uri, name, size))
        }
      }
    }
    return found
  }

  /**
   * The picked folder's display name. A provider that cannot name it gives an
   * empty string, which Rust passes on as the folder's name.
   */
  private fun folderName(treeUri: Uri): String {
    val rootUri = DocumentsContract.buildDocumentUriUsingTree(
      treeUri,
      DocumentsContract.getTreeDocumentId(treeUri),
    )
    val column = DocumentsContract.Document.COLUMN_DISPLAY_NAME
    return try {
      activity.contentResolver.query(rootUri, arrayOf(column), null, null, null)?.use {
        if (it.moveToFirst()) it.text(column) ?: "" else ""
      } ?: ""
    } catch (_: Exception) {
      ""
    }
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
