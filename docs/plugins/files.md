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

`files.pick`, `files.read`, `files.stat`, `files.requestAccess`, `files.release`, and `files.list` need `files:pick`. `files.save` needs `files:save` instead, so a Plugin that only exports files never holds a way to the author's files. A call without the permission it needs is refused with `permission-denied`.

## Picking a file

`client.files.pick({ extensions })` shows Maibuk's file dialog, filtered to the file types you list: lowercase, without a dot, such as `pdf` or `epub`. It resolves with the File Grant, or with null when the author cancels the dialog. One file at a time; `multiple: false` is the only accepted value today.

Picking a file the Plugin already holds a grant for returns the same grant id, so a re-pick after a restart never duplicates a document in your own list.

`files.pick` is a user action: Maibuk refuses it with `user-action-required` unless the author's own click, key press, or Command run caused the call. Call it from a button's handler or from a Command you registered, never from startup code, a timer, or an event handler that fires without the author. `files.requestAccess` has the same rule.

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

In the web build the grant is a browser file handle kept in IndexedDB. The browser may ask the author for access again, inside a click, before the bytes can be read; that is the `file-needs-permission` refusal. Where the browser has no such handles, the grant lasts only for the session, and the Plugin picks the file again after a reload. Saving uses the browser's save picker where there is one; a browser without it, or one that refuses the picker because the page is insecure or the click window ran out, downloads the file instead, and `saved` then means the browser took it.

On Android no native grant store is registered yet, so grants live in memory and last for the session. Saving works there through the same Tauri saver: the picker always creates a new document, so there is no earlier file to protect and Rust writes that document in place, emptying it when a save fails partway where the provider allows it; a cloud provider can hand out a stream that cannot be truncated. A cancelled dialog creates nothing.

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

`createTestHost()` takes a `files` list, which seeds the host's File Grant store, and exposes the rest through `host.files`: `queuePick()` is the file the next `files.pick` returns, `setMissing()` makes a grant unreadable, and `grants()` lists what the host holds. It records saves too: `saves` lists every file the host wrote, in order, with its name, MIME type, and bytes, and `queueSaveCancel()` plays the author closing the next save dialog, after which that call resolves `cancelled` and records nothing. The test host saves in memory instead of opening a dialog, so a test asserts the bytes the host received. A pick and a save count as the author's action inside the test host, so a test never has to fake a click. See [Testing](testing.md).
