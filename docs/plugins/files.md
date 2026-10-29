# Reading files

A Plugin that needs a file from outside the Library asks Maibuk for it, and reads it back in ranges. Maibuk shows its own file dialog, keeps the file's handle on this device, and gives the Plugin a **File Grant**: an id, a name, and a size. The Plugin never learns where the file lives, and the bytes come to it one range at a time, so a 200 MB PDF crosses the Worker boundary in pieces instead of all at once.

A File Grant is not part of the Library. It is device-local, scoped to the Plugin that asked for it, and kept outside the database, so Backups, Database Files, and Sync never carry it: a handle to a file on one machine means nothing on another.

## Requesting the file

Declare the `files:pick` Plugin Permission in the manifest, under `permissions.required` or `permissions.optional`:

```json
"permissions": { "required": ["files:pick"], "optional": [] }
```

A required entry makes the author approve it to enable the Plugin. An optional entry lets the author revoke it on its own, and revoking it ends every File Grant the Plugin holds.

Every `files.*` method needs this one permission. A Plugin without it is refused every one of them with `permission-denied`.

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

Maibuk never writes to, moves, or deletes the author's file. A Plugin that wants the author's changes saved asks them to save it in their own editor.

## When a call is refused

| Code                    | When                                                                                              | What the Plugin can do                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `file-missing`          | the grant id is unknown to this Plugin, or the file was moved, renamed, or deleted outside Maibuk | Mark the document missing and offer a pick, which refreshes the grant |
| `file-needs-permission` | the web build only: the browser must ask the author again before it hands over the bytes          | Call `files.requestAccess` from a click or Command, then read again   |
| `user-action-required`  | `files.pick` or `files.requestAccess` ran without the author's click, key press, or Command run   | Move the call into the author's action                                |
| `permission-denied`     | the Plugin does not hold `files:pick`                                                             | Ask the author to grant it; there is nothing to retry until then      |

## Desktop, web, and Android

On desktop, Rust keeps the grant's path in its own store and reads the file only after checking that the grant belongs to the calling Plugin. The webview's file-system scope is never widened, so Plugin code cannot read anything the author did not pick.

In the web build the grant is a browser file handle kept in IndexedDB. The browser may ask the author for access again, inside a click, before the bytes can be read; that is the `file-needs-permission` refusal. Where the browser has no such handles, the grant lasts only for the session, and the Plugin picks the file again after a reload.

On Android no native store is registered yet, so grants live in memory and last for the session.

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

`createTestHost()` takes a `files` list, which seeds the host's File Grant store, and exposes the rest through `host.files`: `queuePick()` is the file the next `files.pick` returns, `setMissing()` makes a grant unreadable, and `grants()` lists what the host holds. A pick counts as the author's action inside the test host, so a test never has to fake a click. See [Testing](testing.md).
