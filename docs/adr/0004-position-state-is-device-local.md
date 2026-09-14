---
status: accepted (not implemented)
---

# Position state is device-local

Where the author is (Last Opened Chapter, a Canvas's pan and zoom) will belong to Reading Position on each device and never sync. Today `last_chapter_id` lives on the synced book row, so switching Chapters bumps the Book's `updated_at` and schedules Auto Sync for a Book whose text did not change. The sync checksum already strips this state out by hand (`normalizeBookSnapshotJson`), a patch every such field would need again, and the Canvas viewport lives inside the Canvas content, where the same false edits would reach Sync once Canvases sync.

## Considered Options

- Keep position state synced and strip each such field from the checksum: rejected, that is today's patch, and every new position field would repeat it and still schedule sync runs.

## Consequences

- The viewport is excluded from the synced Canvas payload and its checksum.
- Moving `last_chapter_id` off the synced Book needs a migration that seeds each device's Reading Position from the current value.
