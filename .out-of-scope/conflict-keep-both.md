# Keep both sides of a Sync Conflict

When a Synced Item changed on this device and elsewhere, the Conflict dialog
asks the author to pick one state: **Keep Local & Push** or **Use Remote &
Pull** (for a Deleted Elsewhere item, **Keep & Push** or **Delete Here**), or
Cancel. There is no third choice that keeps both states as separate items.

## Why this is out of scope

Keeping both would create a new Synced Item on every device. That is not one
dialog button. It needs:

- a glossary term for the copy, and rules for what it is per kind: a Book with
  Chapters, Checkpoints and covers, a Note with its Book or Unfiled place, a
  Canvas whose Note References point at one side or the other;
- a decision about whether the copy Pushes to the other devices, where it then
  shows up as an item nobody asked for;
- a Deferred path, since Auto Sync never prompts.

Most of what "keep both" would give is already covered without a new item. A
Conflict resolved with Pull takes a Checkpoint of the local Book first
(`bookAdapter.beforePull` in `src/features/sync/sync-engine.ts`, called from
`pullEntity` in `src/features/sync/entity-sync.ts`), so the losing Book state
can be restored from Version history. Every sync run also takes a pre-sync
Backup of the whole Library.

The gap that remains is Notes and Canvases: they have no snapshot before a
Pull, so their losing side is only in the pre-sync Backup. Closing that gap
means a snapshot before a Pull, not a "keep both" choice.

## Prior requests

- #356: "Sync Conflict: decide whether to offer \"keep both\""
