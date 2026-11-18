---
status: accepted
---

# Canvas References resolve through sources, and a source's answer is never written into the Canvas document

A Canvas Reference stores a source id, a target id, and the label it had when placed: `{ kind: "reference"; source; targetId; label? }`. What the card shows comes from asking the source when the Canvas opens. We chose this so a Plugin item (a Map, a Reader Document) can sit on a Canvas without the host knowing its type, and so renaming or deleting a target never edits a Canvas, which under whole-document Canvas Sync (ADR 0006) would cause Pushes and Conflicts on every device.

The `reference` kind replaces `noteRef` at Canvas `schemaVersion` 5. The reader maps a stored `noteRef` node to `source: "note"`; the writer emits only `reference`. A `reference` with a source this app does not know loads and is kept on save.

Decided while triaging [#785](https://github.com/M4ss1ck/maibuk/issues/785); the node kind landed in [#831](https://github.com/M4ss1ck/maibuk/issues/831).

## Considered Options

- Store a snapshot (title, thumbnail) in the node and refresh it: rejected. Every refresh is a Canvas edit and a Push.
- Never resolve, and find out a target is gone only on Open: rejected. A Canvas would show stale titles and no missing state.
- A Plugin-rendered card or picker: rejected. It multiplies keyboard paths and puts a sandbox render per card on a dense Canvas.

## Consequences

- Opening a Canvas that holds Plugin references starts those Plugins' sandboxes.
- A Canvas synced to a device without the Plugin or its data shows those references as Unavailable or Missing, with their stored labels.
- A Canvas at `schemaVersion` 5 is read-only on an app that only knows 4 (ADR 0006).
