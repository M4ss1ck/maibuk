---
status: accepted (not implemented)
---

# Versions and metrics stay outside Entity Sync

Entity Sync will unify Books, Notes, and Canvases behind one adapter shape because they share the three-way Push, Pull, or Conflict decision. Versions and metrics data do not: the sync server's object contract makes them immutable, and they combine as an append-only union with no Conflict. They stay their own modules and share only the remote port with Entity Sync, so a later cleanup should not fold them in with no-op conflict handling.

## Considered Options

- One adapter shape for all synced data, with no-op Conflict handling for Versions and metrics: rejected, half of the adapter's interface would go unused for them, and their append-only union would hide behind a three-way decision it never takes.
