---
status: accepted
---

# The MCP server is a Plugin, reached through a reserved Plugin path

Maibuk's MCP server is the Built-in Plugin `maibuk-mcp`, and it uses nothing a third-party Plugin could not use. Maibuk publishes what a Plugin may do; the Plugin decides which part of that to expose as MCP tools and owns the protocol, tool shapes, short ids, read windows, edits, and the activity log. The shipped Plugin starts off and asks for its Permissions like any other, so a user's own MCP Plugin works exactly the same.

Agents reach it over Streamable HTTP at a Plugin Endpoint: Maibuk binds one `127.0.0.1` port, only while an enabled Plugin holds the `serve` Permission, and hands each request under `/plugin/<pluginId>/` to that Plugin, which answers it. The host enforces what the spec asks of every local HTTP server (bind to localhost, refuse an invalid `Origin`, check `Host`) once, for every Plugin. The Plugin checks its own Key, which the Agent sends as a bearer header from the setup snippet. The port is fixed so snippets stay valid, with a setting for when another app holds it.

Other host changes are limited to Library capabilities any Plugin could want and could not get another way: `books.update`, `books.checkpoint`, Chapter create, Delete, reorder, and metadata updates, and Note Delete and Tag and Book updates.

Decided in the #412 grilling, 2026-10-20. Research: `docs/research/plugins-mcp-feasibility.md`, `docs/research/mcp-server-token-efficiency.md`.

## Considered Options

- A host Unix socket or named pipe plus a console bridge, as the feasibility research proposed: rejected. It is MCP-shaped transport in the host for one Plugin.
- A generic `channel` Permission with a `maibuk-channel` sidecar binary: rejected. It ships and maintains a binary for a need HTTP routing covers.
- A JavaScript relay in the Plugin zip that the Agent runs with `node`, listening on localhost while the Plugin connects out through `network:localhost`: rejected after first being chosen. It needs Node on the author's machine, a host row for the Plugin's folder path, a port hub inside the Plugin for several Agents, an HMAC handshake, and reconnect polling. The reserved path replaces all of that with one generic listener.
- A relay published to npm, or native relay binaries in the zip: rejected. The first ships outside the Plugin; the second breaks ADR 0020.
- The feasibility research rejected localhost HTTP because stdio covered every client. Any design here opens a localhost port, so that reason no longer applies.
- Markdown conversion in the Plugin: rejected. Maibuk's converter needs a DOM that Workers lack, and bundling one is an expensive dependency. v1 reads and writes the `text` and `html` the host already provides.
- Search in v1: deferred to global search (#584). Searching in the Plugin means one read per item, which the broker's rate limit makes slow on a large Library.

## Consequences

- Claude Desktop is not supported: its local configuration launches stdio commands only. A stdio shim can add it later.
- Edits are string find-and-replace on stored HTML, so a match that crosses formatting fails and the Agent falls back to sending HTML.
