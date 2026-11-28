# Reading and saving files

A Plugin that needs a file from outside the Library asks Maibuk for it, and reads it back in ranges. Maibuk shows its own file dialog, keeps the file's handle on this device, and gives the Plugin a **File Grant**: an id, a name, and a size. The Plugin never learns where the file lives, and the bytes come to it one range at a time, so a 200 MB PDF crosses the Worker boundary in pieces instead of all at once.

A Plugin that produces a file takes the other direction: it hands Maibuk the bytes and a name, Maibuk asks the author where to put them, and writes the file there without ever telling the Plugin the path.

A File Grant is not part of the Library. It is device-local, scoped to the Plugin that asked for it, and kept outside the database, so Backups, Database Files, and Sync never carry it: a handle to a file on one machine means nothing on another.

## Requesting the permission

Declare `files:pick` for reading and `files:save` for saving, under `permissions.required` or `permissions.optional`:

```json
"permissions": { "required": ["files:pick", "files:save"], "optional": [] }
```

A required entry makes the author approve it to enable the Plugin. An optional entry lets the author revoke it on its own, and revoking `files:pick` ends every File Grant the Plugin holds.

`files.pick`, `files.read`, `files.stat`, `files.requestAccess`, `files.release`, `files.list`, and the `files.dropped` event need `files:pick`. `files.save` needs `files:save` instead, so a Plugin that only exports files never holds a way to the author's files. A call without the permission it needs is refused with `permission-denied`.

## Picking a file

`client.files.pick({ extensions })` shows Maibuk's file dialog, filtered to the file types you list: lowercase, without a dot, such as `pdf` or `epub`. It resolves with the File Grant, or with null when the author cancels the dialog. One file at a time; `multiple: false` is the only accepted value today.

Picking a file the Plugin already holds a grant for returns the same grant id, so a re-pick after a restart never duplicates a document in your own list.

`files.pick` is a user action: Maibuk refuses it with `user-action-required` unless the author's own click, key press, or Command run caused the call. Call it from a button's handler or from a Command you registered, never from startup code, a timer, or an event handler that fires without the author. `files.requestAccess` has the same rule.

## Picking several files

`client.files.pick({ extensions, multiple: true })` shows the same file dialog with several files allowed, and resolves with `{ grants }`: one File Grant per picked file, in the order the dialog returned them, each once. The dialog offers only files of a type in `extensions`, as a single pick does. Every grant is exactly the one a single pick of that file returns: same shape, same dedupe, so a file you already hold comes back with its grant id, and it reads, stats, and releases the same way. It resolves with null when the author cancels or picks nothing.

`folder: true` wins over `multiple: true`: a call with both is a folder pick, and it resolves as one does (see below). In TypeScript, `multiple: true` types the result as `{ grants } | null`; a call without it keeps the File Grant type.

## Picking a folder

`client.files.pick({ extensions, folder: true })` shows the folder dialog instead. Maibuk walks the picked folder and all its subfolders once, right then, and resolves with `{ folder, grants }`: `folder` is the folder's own name (never its path), and `grants` holds one File Grant per file of a type in `extensions`, matched ignoring case, so `BOOK.EPUB` matches `epub`. Every grant is exactly the one a single pick of that file returns: same shape, same dedupe, and it reads, stats, and releases the same way. A file you already hold a grant for comes back with that grant id, and each grant appears once. It resolves with null when the author cancels.

Symbolic links are not followed, so a link back up the tree never loops. Maibuk keeps nothing about the folder: it never watches it, and picking it again walks it again, so new files come back as new grants and the ones you hold come back with their old ids. A folder pick is a user action, like a file pick, and needs the same `files:pick` permission.

In TypeScript, `folder: true` types the result as `{ folder, grants } | null`; a call without it keeps the File Grant type.

## Dropping files

Subscribe to `files.dropped` and the author can drag files from their device onto your Plugin's pages instead of walking the file dialog:

```ts
await client.on("files.dropped", async ({ page, grants }) => {
  for (const { grant, name } of grants) {
    if (!name.endsWith(".pdf")) await client.files.release({ grant });
  }
});
```

The event needs `files:pick`, like picking does. `page` is the id of your page that received the drop, so each page can respond in its own way. `grants` holds one File Grant per dropped file, in the order the author dropped them, with the same shape `files.pick` returns and the same dedupe: dropping a file you already hold a grant for hands back that grant id. Every dropped file arrives whatever its type, because an event takes no filter, so release the grants you can't use. A dropped folder is not expanded.

Maibuk delivers a drop only to the Plugin whose page, a host-rendered page or a Frame, is under the drop point, and only while that Plugin is subscribed and holds `files:pick`. A drop on Maibuk's own chrome, on the sidebar, or on another Plugin's page never reaches you, and a Plugin that never subscribed sees drops behave as they did before. Over a page that takes drops the author sees the system's copy cursor; Maibuk draws no dropzone, so any drop feedback is yours to draw. Drops reach your Plugin in the order the author made them.

The event is not a user action: Maibuk mints the grants itself as part of the author's drop, and it opens no window for a later `files.pick` or `files.requestAccess`.

Grants from a drop persist exactly like picked ones. On desktop, Rust grants only the paths its own drag-and-drop handler saw in the most recent drop, so webview code cannot turn a path it made up into a grant. In a Chromium browser the dropped file's handle is kept in IndexedDB and the grant survives a reload; in a browser without file handles the grant lasts for the session, as a picked one does there.

## Reading in ranges

`client.files.read({ grant, offset, length })` resolves with an `ArrayBuffer` of at most `length` bytes, starting at `offset`. One call carries at most `FILE_READ_MAX_BYTES`, exported by the SDK, which stays under the Plugin message cap; ask for more and the call is refused with `invalid-params`. Loop until you have read the file's size:

```ts
import { FILE_READ_MAX_BYTES } from "@maibuk/plugin-sdk";

for (let offset = 0; offset < size; offset += FILE_READ_MAX_BYTES) {
  const bytes = new Uint8Array(
    await client.files.read({ grant, offset, length: FILE_READ_MAX_BYTES })
  );
  await store(bytes);
}
```

A range that runs past the end of the file returns the bytes that exist: shorter than you asked for, and empty at or past the end. The file may also have shrunk since you read its size, so treat the short read as the end rather than as an error, and ask `files.stat` again before trusting a stale size.

`client.files.stat({ grant })` resolves with the grant's name, size, and last-modified time without opening the file, so a Plugin can mark a document as changed or missing cheaply. `client.files.list()` resolves with every live grant the Plugin holds on this device: id, name, and size each.

A File Grant is read-only: Maibuk never writes to, moves, or deletes the file behind it. A Plugin that wants the author's changes saved asks them to save it in their own editor.

## Saving a file

`client.files.save({ name, mimeType, bytes })` hands Maibuk one file to write where the author chooses. Pass the bytes as a `Uint8Array`, a `Blob`, or an `AsyncIterable<Uint8Array>`; the SDK gathers them into one `Blob` and sends it right after the call, so the file travels as a `blob` message instead of inside the JSON one. There is no size cap.

The call resolves with `{ status: "saved" }` once Maibuk wrote the file, or `{ status: "cancelled" }` when the author closed the save dialog without choosing a place. A save that fails, such as on a full disk, is refused with `internal-error`, carrying the reason.

Like `files.pick`, `files.save` is a user action: Maibuk refuses it with `user-action-required` unless the author's own click, key press, or Command run caused the call. Call it from a button's handler or from a Command you registered, never from startup code or a timer.

`name` is the name the dialog is prefilled with, and the file type it ends in sets the dialog's filter: `map.png` offers PNG. A name with no dot, or with one only as its first or last character, is refused with `invalid-params`, and so is one ending in a type a program or installer uses. The refused types are `exe`, `msi`, `bat`, `cmd`, `com`, `scr`, `ps1`, `sh`, `app`, `dmg`, `pkg`, `deb`, `rpm`, `appimage`, `desktop`, `jar`, and `lnk`, compared without case. `html` and `svg` are allowed.

Maibuk keeps only a safe base name from what you send: the folder part goes, then every control character, then any leading dot, and the rest is trimmed and cut to 255 UTF-8 bytes with the file type kept whole. That is the name the author sees in the dialog.

A save creates no File Grant and returns none: there is nothing to release, and the Plugin never learns where the file went. Maibuk shows no toast for a save; the outcome comes back to the Plugin, which reports it to the author.

```ts
const { status } = await client.files.save({
  name: "map.png",
  mimeType: "image/png",
  bytes: await drawMap(),
});
if (status === "saved") {
  await client.notifications.show({ variant: "success", message: "Map saved" });
}
```

## When a call is refused

| Code                    | When                                                                                                                 | What the Plugin can do                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `file-missing`          | the grant id is unknown to this Plugin, or the file was moved, renamed, or deleted outside Maibuk                    | Mark the document missing and offer a pick, which refreshes the grant     |
| `file-needs-permission` | the web build only: the browser must ask the author again before it hands over the bytes                             | Call `files.requestAccess` from a click or Command, then read again       |
| `invalid-params`        | a `files.save` name has no file type or one the host refuses, or a `files.read` length exceeds `FILE_READ_MAX_BYTES` | Pick a name with a file type Maibuk may write, and read in smaller ranges |
| `user-action-required`  | `files.pick`, `files.save`, or `files.requestAccess` ran without the author's click, key press, or Command run       | Move the call into the author's action                                    |
| `permission-denied`     | the Plugin does not hold `files:pick`, or `files:save` for `files.save`                                              | Ask the author to grant it; there is nothing to retry until then          |
| `not-implemented`       | `files.save` on a device with no saver                                                                               | Nothing to retry on this device                                           |
| `internal-error`        | the save failed, such as on a full disk                                                                              | Report the failure to the author and try again                            |

## Desktop, web, and Android

On desktop, Rust keeps the grant's path in its own store and reads the file only after checking that the grant belongs to the calling Plugin. The webview's file-system scope is never widened, so Plugin code cannot read anything the author did not pick. A save works the same way: Rust shows the dialog, writes a sibling `.part` file, and renames it over the target once every byte arrived, so a save that fails partway leaves the file the author chose to replace as it was. The webview only holds a token for the save; the chosen path never leaves Rust.

In the web build the grant is a browser file handle kept in IndexedDB. The browser may ask the author for access again, inside a click, before the bytes can be read; that is the `file-needs-permission` refusal. Where the browser has no such handles, the grant lasts only for the session, and the Plugin picks the file again after a reload. A folder pick uses the browser's directory picker where there is one (Chromium) and keeps each file's handle like a picked file's; elsewhere it uses the folder upload input, whose grants last for the session. Saving uses the browser's save picker where there is one; a browser without it, or one that refuses the picker because the page is insecure or the click window ran out, downloads the file instead, and `saved` then means the browser took it.

On Android `files.pick` opens the system document picker, and Maibuk keeps the read permission the picker grants, so the File Grant survives a restart as on desktop. A document from a provider that does not let an app keep that permission, such as some cloud storage apps, reads until Maibuk closes and as `file-missing` after; picking it again refreshes the grant. A folder pick opens the system folder picker, and Maibuk keeps read access to that folder for as long as any grant from it lives. Android has no file drop, so `files.dropped` never fires there. Saving works through the same Tauri saver: the picker always creates a new document, so there is no earlier file to protect and Rust writes that document in place, emptying it when a save fails partway where the provider allows it; a cloud provider can hand out a stream that cannot be truncated. A cancelled dialog creates nothing.

## When a grant ends, and when it survives

A File Grant ends when the Plugin calls `files.release` for it, when the Plugin is removed, when the author revokes `files:pick`, or when the author runs Reset settings, which clears Plugin access on this device.

A File Grant survives Restore, Reset Library, and loading a Database File: those replace or clear the Library, and a File Grant was never part of it. Restoring a Backup on another device brings back the Plugin's storage, not its grants, so a Plugin that lists documents should re-check every grant with `files.stat` and offer a pick for the ones that fail.

## Example: read the first 64 KB

```ts
import type { PluginClient } from "@maibuk/plugin-sdk";

const FIRST_64_KB = 64 * 1024;

/** Picks a file in the author's click and reads its opening bytes as text. */
export async function readOpening(client: PluginClient): Promise<string | null> {
  const file = await client.files.pick({ extensions: ["txt", "md"] });
  if (file === null) return null;
  const length = Math.max(1, Math.min(file.size, FIRST_64_KB));
  const bytes = await client.files.read({ grant: file.grant, offset: 0, length });
  return new TextDecoder().decode(bytes);
}
```

## Testing

`createTestHost()` takes a `files` list, which seeds the host's File Grant store, and exposes the rest through `host.files`: `queuePick()` is the file the next `files.pick` returns, `queueFolderPick({ name, files })` is the folder the next `files.pick` with `folder: true` walks (list every file in it, matching or not, and the host keeps the file types you asked for), `queueFilesPick(files)` is the list the next `files.pick` with `multiple: true` returns, in order (`null` for a cancel), `drop(pageId, files)` plays the author dropping files on one of your pages and resolves with whether `files.dropped` reached your Plugin, `setMissing()` makes a grant unreadable, and `grants()` lists what the host holds. It records saves too: `saves` lists every file the host wrote, in order, with its name, MIME type, and bytes, and `queueSaveCancel()` plays the author closing the next save dialog, after which that call resolves `cancelled` and records nothing. The test host saves in memory instead of opening a dialog, so a test asserts the bytes the host received. A pick and a save count as the author's action inside the test host, so a test never has to fake a click. See [Testing](testing.md).
