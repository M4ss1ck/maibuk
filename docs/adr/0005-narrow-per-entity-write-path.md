---
status: accepted
---

# Narrow per-entity write path

Signalling a Change is a convention each writer has to remember, and Version restore (`versions/store.ts`) never calls `notifyLocalChange()`. Each synced entity will get one write path (normalize, write, return stored content, emit the Change) that stores, Restore, Import, and the sync serializer all call. The Zustand stores keep their current shape as in-memory views; this is deliberately not a full repository layer.

## Considered Options

- Full entity repositories with stores reduced to views: rejected for now, it rewrites the store pattern documented in AGENTS.md without fixing more defects than the narrow path. Revisit if stores keep accumulating write logic.
