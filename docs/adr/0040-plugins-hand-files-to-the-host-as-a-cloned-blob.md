---
status: accepted
---

# Plugins hand files to the host as a cloned Blob

A Plugin that saves a file through `files.save` sends the usual JSON `call` head, then one non-string message, `{ kind: "blob", id, blob }`, that carries the file as a `Blob` by structured clone. This is the one exception to the rule that Plugin to host messages are JSON strings. Cloning a `Blob` copies a handle, not the bytes, so the broker never base64-decodes or parses the file on the main thread, and the host streams `blob.stream()` straight to the file the author picked. There is no size cap: the author's disk is the limit. The broker accepts a `blob` message only when its `id` belongs to a pending `files.save` and its `blob` is a `Blob`, and each one takes a rate-limit token like any other message.

Decided while triaging [#735](https://github.com/M4ss1ck/maibuk/issues/735), which the Maps Built-in Plugin needs for PNG and SVG export (ADR 0039).

## Considered Options

- Raise the 4 MB message cap for `files.save`: rejected. The broker decodes Plugin messages on the main thread, and a 64 MB file is an 85 MB base64 string whose `JSON.parse` freezes typing and holds several copies of the file. The length check runs after the browser has already copied the string into the host.
- Chunked base64 under a stated total cap (64 MB was proposed): rejected. A cap is arbitrary (a 3D asset Plugin would outgrow it), and without one the host must write each chunk as it arrives behind a credit window so a Plugin cannot make it buffer. That is a lot of protocol for bytes the host never needs to read.
- Let the Plugin save without the host: not possible. A Frame is `sandbox="allow-scripts"` with an opaque origin, a headless Plugin is a Worker, and neither can show a save picker or start a download. Adding `allow-downloads` would let a Plugin drop files with no dialog and no author action, and `allow-same-origin` on a `srcdoc` frame hands it the host's origin.

## Consequences

- The broker's size defense still covers every JSON message. The `blob` message is the only non-string message the broker accepts, and only for a method whose table row says it takes one.
- Cloning a `Blob` across a MessagePort from an opaque-origin Frame or a Worker into WebKitGTK is standard behavior, but it was unproven in this codebase when this ADR was written. The first implementation step proves it in the `@sandbox` E2E lane.
- On the desktop the host writes to a sibling `.part` file and renames it over the target, so a save that fails partway never destroys a file the author chose to replace. On Android the save picker creates a new document, so there is no old file to protect: the host writes it in place and empties it when a save fails, where the provider allows it.
