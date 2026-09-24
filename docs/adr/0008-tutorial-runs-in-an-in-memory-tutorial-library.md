---
status: accepted (not implemented)
---

# The Tutorial runs in an in-memory Tutorial Library

The Tutorial has to show features that only appear with content (an Outline, Checkpoints, Book Status filters, a populated Canvas), while a new author's Library is empty. While it runs, the database connection is switched to an in-memory Library seeded through the real per-entity write paths with localized sample content, and switched back when it ends. Nothing sample reaches disk, so it cannot leak into Sync, Backups, Metrics, or the Change Feed consumers by construction rather than by filtering.

## Considered Options

- A real sample Book the author keeps: rejected, it syncs to every device, stays in the Library, and deleting it later leaves a Tombstone and a Deletion Review entry for content the author never wrote.
- Illustrations inside the step card, running on the author's real (often empty) screens: rejected, the real UI would never be shown with content in it.
- Per-screen parts triggered on first visit: rejected once the Tutorial Library existed, since each would swap the author's own content out for sample content mid-visit; the Tutorial is one linear run that navigates between screens itself.

## Consequences

- Every background job that touches the Library (Auto Sync, Backups, Checkpoints, Metrics, Reading Position, the saved last path) checks one switch and does nothing while the Tutorial Library is active; each needs a test proving it.
- Entry and exit follow a fixed order: Flush open editors, settle buffered metrics, switch, reload stores. Pending edits never cross the switch.
- Sample ids carry a `tutorial-` prefix, and the per-entity write paths refuse them against the real Library.
- The Tutorial never overlaps a sync run, and closing the app mid-Tutorial switches back before the close Backup.
- The author cannot interact with sample content: only the Tutorial's own shortcuts are live while it runs.
- Ephemeral lives outside the database, so the Tutorial saves and restores the author's buffer around its Ephemeral section.
