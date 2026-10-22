---
status: accepted
---

# A Version is a manifest over shared content, and Backups stay self-contained

Each Version used to store a full copy of its Book, cover included, so 101 Checkpoints of a 5-Book Library held 81.7 MB for 4.0 MB of live text, and every Backup paid for that again. A Version is now a manifest: per-Chapter rows that point at content-addressed text (sha256 of the exact content), plus the Cover the same way. Saving a Version stores only content no other Version already holds; deleting one sweeps only content nothing else references. Every Version stays complete and restorable on its own, the way Git commits share blobs, and old full-copy Versions stay readable forever for old Backups and Database Files.

## Considered Options

- Delta chains (each Version a patch on the previous one): rejected. Deleting or pruning a Version would break the ones after it, and Restore would replay a chain.
- Incremental Backup files (one base dump plus daily deltas): rejected. A Backup must restore from one file with nothing else present.
- Compressing stored content: deferred. After sharing, the measured content is about 5 MB, so a second format to maintain buys little.

## Consequences

- A Backup or Database File made by this Release is forward-only: an older app refuses it with a "made by a newer version" message from the dump header instead of failing on unknown tables.
- The sync wire format is unchanged: a pushed Version is still one whole Book, and a pulled one is split into the manifest on arrival.
