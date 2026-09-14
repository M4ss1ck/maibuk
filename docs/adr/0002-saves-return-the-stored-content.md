---
status: accepted
---

# Saves return the stored content

Saving a Chapter normalizes its HTML (heading ids), so the stored text differs from what the editor sent and comes back through the store looking like an outside change. `Editor` guards against that with a heuristic window of the last 30 emitted documents. Instead, every save will return the content exactly as stored, and the Edit Session will compare incoming content against that one value: equal means its own echo, different means a real outside change such as a Pull.

## Considered Options

- Keep the recent-emits window in `Editor`: rejected, it is a guess and has already needed two caret-jump fixes (#123, #128).
- Move the window into the Edit Session unchanged: rejected, it relocates the guess without removing it.

## Consequences

- Every save path (stores, Restore, Import, the sync serializer) must return the content as stored. The Edit Session and its tests depend on that contract, so going back to a heuristic means rewriting both.
