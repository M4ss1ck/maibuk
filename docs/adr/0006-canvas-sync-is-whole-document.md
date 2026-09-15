---
status: accepted (implemented)
---

# Canvas sync is whole-document

When Canvases sync, each will be one Synced Item with the same three-way decision and Conflict dialog as Books and Notes, with no combining of edits per node. That keeps Canvas a plain adapter of Entity Sync; per-node combining would need its own conflict model that real use has not asked for.

## Consequences

- A pulled Canvas with a newer `schemaVersion` than this app understands is stored read-only and never Pushed from this device.
- Deleting a Note never edits Canvases: its Note References become Missing Note References, so a Delete on one device causes no Canvas Pushes or Conflicts elsewhere.
- Canvases can be several MB (embedded images): hashing and encryption run in the sync codec worker, and the sync server's 50 MB object limit (`maibuk-sync`, `pb_migrations/007_objects.js`) surfaces as a clear Sync Log error.
- The `canvas` kind is documented in the sync server's object contract before the client ships; the contract makes new kinds a documentation change, not a server change.
