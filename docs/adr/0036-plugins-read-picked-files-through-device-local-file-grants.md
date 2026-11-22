---
status: accepted
---

# Plugins read picked files through device-local File Grants

A Plugin that holds the `files:pick` Plugin Permission asks Maibuk to show its native file dialog, and gets back a File Grant id with the file's name and size, never a path. It reads the bytes later in ranges, each under the Plugin message cap, through that File Grant. File Grants are kept per Plugin on this device, outside the Library: Backups, Database Files, and Sync never carry them, because a path or browser file handle means nothing on another device. A File Grant ends when the Plugin releases it, when the Plugin is removed, or when `files:pick` is revoked. On desktop, Rust reads the file only after it checks the File Grant, and the webview's `fs` scope is never widened (as in ADR 0010). On the web, a File Grant is a `FileSystemFileHandle` kept in IndexedDB, and the browser may ask the author again, after a click, before it can be read. Where the browser has no such handles, a File Grant lasts only for the session.

Decided while scoping the Reader Built-in Plugin ([#653](https://github.com/M4ss1ck/maibuk/issues/653)), the first Plugin that needs files from outside the Library. The host publishes a generic capability and the Plugin builds on it, as for every other Plugin need.

## Considered Options

- Copy picked files into Plugin storage: rejected. Plugin storage is Library data (ADR 0023). On the web the Library writes the whole database on every save, and every Backup would carry 50 to 200 MB PDFs.
- Hand the Plugin the path, and widen the `fs` scope to it: rejected. A path leaks the author's folder layout to Plugin code, and a widened scope outlives the Plugin's need for it.
- Register Maibuk as an OS handler for these file types: rejected for now. It does not solve remembering files, and it raises the question of whether opening an EPUB from the OS should import it or read it.

## Consequences

- A Document moved or deleted outside Maibuk turns unreadable. Picking the file again refreshes its File Grant.
- Reset settings, which clears Plugin grants, also clears File Grants. Restoring a Backup leaves them alone.

## Amendment: File Grants on Android (2026-11-21)

Android keeps File Grants too, through the same Rust record as desktop. The picker is the system document picker (`ACTION_OPEN_DOCUMENT`), and Maibuk takes a persisted read permission on the document it returns, so a Plugin's grant still reads after a restart. The record holds the document's `content://` URI and its display name in place of a path; the URI stays in Rust, and the webview only sees the grant id. Rust reads the bytes through the content resolver, in ranges, as on desktop. When the last grant on a document ends, Maibuk gives the permission back.

Why: Reader and Maps run on Android (ADR 0021, 2026-11-21 amendment), and both pick files. Before this, Android used the memory store, so no file could be read at all.

Considered Options:

- The dialog plugin's picker: rejected. It uses `ACTION_GET_CONTENT`, whose permission ends with the process, so every grant would read as gone after a restart, and it returns no display name.
- Copy the picked file into app storage: rejected for the same reasons as copying into Plugin storage above, and a copy would also stop matching the author's file when they change it.

Consequences:

- A document from a provider that offers no persisted permission reads for this run and as gone after a restart; picking it again refreshes it, as for a moved file on desktop.
- Android caps how many persisted permissions an app holds (128 before Android 11, 512 from Android 11). Releasing a grant gives its permission back, so the cap counts live grants only.
- Dropping files on a Plugin page stays desktop and web only: Android has no file drop.
