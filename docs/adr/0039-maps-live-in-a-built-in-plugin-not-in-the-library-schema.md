---
status: accepted
---

# Maps live in a Built-in Plugin, not in the Library schema

A Map, its Custom Stamps, and its Custom Terrains are stored in the Maps Built-in Plugin's own storage (ADR 0023), not as a Library item with its own table the way a Cover is. So a Map is in the Library, its Backups, and a Database File, but it is not a Synced Item: an author who draws a Map on the desktop does not see it on the web. We chose this so Maps ship on the generic Plugin capabilities (a Frame, `files.pick`, `files.save`, `editor.insert`) without schema, Sync, Version, or Export work in the host, and so the editor's dependencies (SVG scene, rough.js, d3-delaunay, bundled fonts, Stamp art) load only for authors who turn the Plugin on.

Decided in [Maps Built-in Plugin](https://github.com/M4ss1ck/maibuk/issues/737).

## Considered Options

- A `maps` Library table with Entity Sync, like Canvases (ADR 0006): rejected for now. It needs a schema migration, a sync adapter, a Tombstone path, and Export rules before the first Map can be drawn, and it would load the map editor into every install.
- Generic Plugin data sync: rejected for now. ADR 0023 explains why Entity Sync cannot compare an opaque Plugin namespace.

## Consequences

- Moving Maps into the Library later means a migration from `plugin_storage` rows into a new table, plus Sync work. That is the cost this ADR accepts.
- A Map placed in a Chapter is a copy (a PNG or JPEG in the Chapter's HTML), so the Chapter, its Versions, and its Exports stay whole when the Plugin is off or removed.
- Custom Stamps and Map Images are stored inside the Library. The web Library writes the whole database on every save, so large uploads slow saves there; Settings already shows each Plugin's data size and warns at 50 MB.
