---
status: accepted
---

# A list Sort is a view, and leaving it keeps its order as the Custom Order

The Notes sidebar's list view sorts Notes at display time from a per-device setting (`notesListSort`, default `custom`), so a Sort keeps Notes in place as they are added, renamed, and edited. It writes `Note.order` only when the author leaves the Sort: dragging a row while sorted writes the shown order with that move and sets the Sort to Custom, and picking Custom writes the shown order of each whole section, Pinned and the rest separately, even while a search hides some Notes. The tree view keeps its own Sort (`notesTreeSort`) and never writes `order`.

## Considered options

- Rewrite `order` once when a Sort is picked, and show the stored order afterwards: rejected. A new or renamed Note lands out of place under a label that still says "A to Z", and the author asked for a Sort that holds.
- Rewrite `order` on every change while a Sort is active: rejected. A rename or keystroke-save would write every Note in the section, and each write is a Change that schedules Auto Sync (ADR 0003), for no visible difference.

## Consequences

- While a list Sort is active, another device keeps showing the previous Custom Order until this device leaves the Sort. The Sort is a device setting, so the other device shows its own Sort anyway.
- Pin, unpin, create, rename, import, and order changes that sync in leave the Sort alone; only a drag in the list or picking Custom changes it.
