---
status: accepted
---

# One Change Feed

Local edits signal Auto Sync through `notifyLocalChange()`, called by hand from each store, while Pulls refresh the UI by having the sync serializer call stores directly. Both will go through one Change Feed of `{ entity, id, origin: "local" | "remote", kind: "content" | "metadata" }`: Auto Sync listens to local Changes, galleries and open editors listen to remote ones. Every synced Change will schedule Auto Sync regardless of kind; the kind only decides whether Last Edited moves (content and title do; pin, order, and status do not).

## Considered Options

- A mirror `remote-changes.ts` beside `local-changes.ts`: rejected, two seams with the same shape double the test surface.
- Metadata Changes wait for the next content sync: rejected, an Archived Book would stay In Progress on other devices indefinitely.
