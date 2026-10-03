# Maibuk MCP server: feasibility

Research date: 2026-10-02, for issue #394 (map #389). Primary sources only: the MCP specification, the official SDK repositories, the official client docs, and Maibuk's own code at `bed1e51d` (origin/main). The standing decisions in #389 (same path for everyone, Worker sandbox, permission-gated message API, declare then activate, every platform, Plugin data in the Library) are inputs here, not open questions.

Pinned sources:

| Source | Ref |
| --- | --- |
| MCP specification | revision `2026-07-28` (released 2026-07-28), repo `modelcontextprotocol/modelcontextprotocol` at `db788e34ffc0` |
| MCP security best practices | `docs/docs/2026-07-28/tutorials/security/security_best_practices.mdx`, same commit |
| Rust SDK (`rmcp`) | `modelcontextprotocol/rust-sdk` `rmcp-v3.5.0` (2026-09-28), main at `8f9a28ecdb5f` |
| TypeScript SDK | `modelcontextprotocol/typescript-sdk` `v2.3.0` (2026-10-02), main at `8aabbdcef6e0` |
| MCPB (bundles) | `modelcontextprotocol/mcpb` README, last push 2026-05-26 |
| WebMCP | `webmachinelearning/webmcp` README and `implementation-status.md`, last push 2026-10-02 |

---

## Summary

**Verdict per platform**

| Platform | Feasible? | Why |
| --- | --- | --- |
| Desktop Linux | Yes | The app owns a Rust process that can listen on a Unix socket; Claude Code, Cursor, and other desktop clients launch local stdio servers. Claude Desktop does not run on Linux (it is "available for macOS and Windows", [connect-local-servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers)). |
| Desktop Windows | Yes | Same design over a named pipe; Claude Desktop, Claude Code, and Cursor all launch stdio servers. Needs a console bridge binary, because the app binary is built with `windows_subsystem = "windows"` (`src-tauri/src/main.rs:2`). |
| Android | No for v1 | An in-process listener is technically possible, but no MCP client runs on the phone to reach it (unverified, see log), Android suspends background apps, and exposing it to a desktop over the LAN makes it a remote server that the spec expects to use OAuth. |
| Web | No | A browser tab cannot listen on a port or socket. The only in-browser route is WebMCP (`navigator.modelContext`), which is an origin trial in Chrome 149 and Edge 150, not a shipped standard. Revisit when it ships. |

**Recommended architecture (desktop only):** the MCP server runs inside the app as one more client of the Plugin API, never beside it.

1. **Transport, Rust, a byte pipe.** When the author turns the MCP server on, the Tauri process listens on a per-user Unix socket (Linux) or named pipe (Windows) and relays newline-delimited JSON-RPC lines to and from the webview. Nothing listens while it is off.
2. **Bridge, a tiny console binary `maibuk-mcp`.** The MCP client launches it over stdio (`claude mcp add maibuk -- maibuk-mcp`); it connects to the socket and copies bytes both ways. The stdio spec allows exactly this: its framing "works unchanged over Unix domain sockets, TCP connections, or any similar channel" ([stdio](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)).
3. **Protocol, TypeScript, in the Plugin host.** The official TS SDK (`@modelcontextprotocol/server`, runtime-neutral root entry, custom `Transport` interface, serves both protocol eras) runs in its own Worker in the webview and calls the Plugin API through the same permission-gated message channel a Plugin uses. Writes therefore go through the per-entity write paths, the Change Feed, Auto Sync, and the Tutorial Library guards with no second implementation.
4. **Tools are generated** from the Plugin API method table (#396): name, description, JSON Schema, required permission, and effect (read or write). A gate test fails when an exposed method has no tool or a tool has no method.

Rejected: an `rmcp` server in Rust (correct SDK, wrong side: every tool still has to cross into the webview, so tool schemas would live twice), a sidecar that opens `maibuk.db` itself (bypasses ADR 0017, the write paths, the Change Feed, and the Tutorial switch), Streamable HTTP on localhost for v1 (a port any local process or a DNS-rebinding page can probe, for no client that stdio does not already cover).

**Effort:** M on top of a finished Plugin platform, against L for the Echoes pilot (which builds the platform). Before the platform exists it is L, because it would need its own API, permission store, and approval UI. Recommendation for #404: not in the pilot; it is the cheapest second consumer of the Plugin API once Echoes ships, and it needs two platform fixes first (section 6).

**Minimum security model:** off by default; socket readable only by the author's account; one pairing token per client, issued by Maibuk and approved in a dialog; each client gets the same permission grant storage as a Plugin (`library:read`, `library:write`, revocable); no `secrets`, `process`, `network`, or UI methods ever exposed; writes refused while the Tutorial runs; a device-local audit log of every call without content. Details in section 5.

---

## 1. The MCP specification today (revision 2026-07-28)

### 1.1 The protocol went stateless

Revision `2026-07-28` is the current one ([releases](https://github.com/modelcontextprotocol/modelcontextprotocol/releases/tag/2026-07-28)). Its changelog ([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)) lists, among others:

- The `initialize` handshake is gone; "every request now carries its protocol version and client capabilities in `_meta`", and servers "MUST implement" `server/discover`.
- Protocol-level sessions and `Mcp-Session-Id` are gone from Streamable HTTP.
- Server-to-client requests (sampling, elicitation, roots) are replaced by Multi Round-Trip Requests: the server returns `input_required` and the client retries.
- Roots, Sampling, and Logging are deprecated.

Clients written for `2025-11-25` and earlier still open with `initialize`. The versioning page defines a "dual-era" server that serves both, and its matrix says a legacy client against a modern-only server "Fails" ([versioning, compatibility matrix](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)). Maibuk's server must be dual-era. Both official SDKs already are: `rmcp` 3.5.0 has `LATEST = V_2026_07_28` and `LATEST_WITH_INITIALIZE = V_2025_11_25` (`crates/rmcp/src/model.rs:170-202`), and the TS SDK "speaks both eras from the same `Client` and serves both from the same entry points" (`docs/protocol-versions.md`).

Which era each client speaks today is not verified (see log). It does not change the design, since the SDK serves both.

### 1.2 Transports

Two standard transports ([transports](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)):

- **stdio**: "the client launches the MCP server as a subprocess", newline-delimited JSON-RPC on stdin/stdout. The binding notes the wire format "works unchanged over Unix domain sockets, TCP connections, or any similar channel", and custom transports on such streams "SHOULD reuse this framing" ([stdio](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)). Servers "SHOULD exit promptly when their standard input is closed".
- **Streamable HTTP**: one POST endpoint. Security section, verbatim: servers "MUST validate the `Origin` header on all incoming connections to prevent DNS rebinding attacks", "When running locally, servers SHOULD bind only to localhost (127.0.0.1)", and "SHOULD implement proper authentication for all connections" ([streamable-http, Security & Endpoint](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)).

### 1.3 Auth for local servers

The authorization spec is OAuth 2.1 for HTTP. For stdio it says: "Implementations using an STDIO transport SHOULD NOT follow this specification, and instead retrieve credentials from the environment" ([authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)). The security best practices, section "Local MCP Server Compromise", tell local servers to "Use the `stdio` transport to limit access to just the MCP client" or, over HTTP, "Require an authorization token" or "Use unix domain sockets or other Interprocess Communication (IPC) mechanisms with restricted access" ([security best practices](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)).

So a local Maibuk server needs no OAuth: stdio plus a token from the environment is the spec's own recommendation.

### 1.4 Tools and the human in the loop

The tools page: "there SHOULD always be a human in the loop with the ability to deny tool invocations", and applications SHOULD "Present confirmation prompts to the user". Tool annotations (`readOnlyHint`, `destructiveHint`) exist but "clients MUST consider tool annotations to be untrusted unless they come from trusted servers" ([tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)). The client's confirmation prompt is the agent user's guard; it is not Maibuk's guard, because the client is the party Maibuk is protecting the Library from.

### 1.5 What clients support

| Client | Platforms | Local transport | How a local server is added | Approval |
| --- | --- | --- | --- | --- |
| Claude Desktop | macOS, Windows ([source](https://modelcontextprotocol.io/docs/develop/connect-local-servers)) | stdio (`command`/`args` in `claude_desktop_config.json`) | Edit the config file, or a one-click `.mcpb` bundle ([mcpb](https://github.com/modelcontextprotocol/mcpb)) | "All actions require your explicit approval before execution" |
| Claude Code | macOS, Linux, Windows | stdio, Streamable HTTP, WebSocket; SSE deprecated ([docs](https://code.claude.com/docs/en/mcp)) | `claude mcp add <name> -- <command>`; HTTP takes `--header "Authorization: Bearer ..."` | Prompts for project-scoped servers; per-tool permission rules |
| Cursor | macOS, Linux, Windows | stdio, SSE, Streamable HTTP ([docs](https://cursor.com/docs/context/mcp)) | `~/.cursor/mcp.json` or `.cursor/mcp.json`; `env` for tokens | "Cursor asks for approval before using MCP tools by default" |

Every client in the table launches stdio servers on every desktop OS it supports. Streamable HTTP adds nothing for a local server.

## 2. SDKs

| SDK | Status (checked with `gh api`, 2026-10-02) | Fit |
| --- | --- | --- |
| `rmcp` (Rust) | 3,972 stars, last push 2026-10-02, 55 open issues, releases 3.4.0 (09-15), 3.4.1 (09-23), 3.5.0 (09-28). MSRV 1.88 (Maibuk builds with 1.96). Feature `transport-async-rw` serves over any `AsyncRead + AsyncWrite`, so a Unix socket or named pipe works without HTTP. Its Streamable HTTP server defaults `allowed_hosts` to loopback (`streamable_http_server/tower.rs:203`) and validates `Origin`. | Well maintained. Wrong side of the app for Maibuk (section 3). |
| TypeScript (`@modelcontextprotocol/server` 2.x) | 13,504 stars, last push 2026-10-02, 607 open issues, v2.3.0 and 1.32.0 both released 2026-10-02. Root entry is "runtime-neutral: its module graph never reaches `node:child_process`" (`docs/get-started/packages.md`); `Transport` is three methods plus three callbacks (`docs/advanced/custom-transports.md`); dual-era. | Fits: runs in a Worker, takes a custom transport, and sits next to the Plugin API's TypeScript types. |

## 3. Hosting from the Tauri app

### 3.1 Where Maibuk's rules live

The facts that decide the architecture:

- Rust owns the Library pool and nothing above it: a lazy pool on `<app config dir>/maibuk.db` behind a SQLite authorizer (ADR 0017, `src-tauri/src/library_db.rs`).
- Every rule an agent write must obey lives in TypeScript in the webview: normalization and stored return values in `src/features/{books,chapters,notes,canvas}/write.ts` (ADR 0005), the Change Feed in `src/features/sync/change-feed.ts` (ADR 0003), Auto Sync scheduling, `assertWritableId()` and the Tutorial Library switch in `src/features/tutorial/library-switch.ts` (ADR 0008).
- Per #389 decision 2, the Plugin API is a permission-gated message API served from the webview to Workers.

Any server that does not end in that message API reimplements these rules or skips them.

### 3.2 Options

| Option | How it reaches the Library | Verdict |
| --- | --- | --- |
| A. `rmcp` in the Tauri process | Reads could use the pool; writes must be forwarded to the webview anyway (3.1). Tool schemas are written in Rust and again in the Plugin API. | Rejected: two sources of truth for every tool. |
| B. Rust byte relay + TS SDK in a Worker, as a Plugin API client | Same message API and permission checks as a Plugin; write paths, Change Feed, Tutorial guards apply unchanged. | **Recommended.** |
| C. Sidecar binary that opens `maibuk.db` directly | Bypasses ADR 0017's authorizer, the write paths, the Change Feed (no Auto Sync, no view refresh), and the Tutorial switch; two writers on one file. | Rejected. |
| D. Streamable HTTP on 127.0.0.1 | Same as B behind an HTTP listener. | Not for v1: an open port with Origin/Host checks and a bearer token, to serve clients that already speak stdio. Keep the option for a client that only speaks HTTP. |

### 3.3 Option B in detail

- **Listener.** Linux: a Unix socket in the app's runtime or config directory, created with mode `0600`. Windows: `\\.\pipe\maibuk-mcp-<user SID>` created with `first_pipe_instance(true)` (stops another process from squatting the name), remote clients rejected (tokio's default: "Remote clients are disabled by default", [ServerOptions](https://docs.rs/tokio/latest/tokio/net/windows/named_pipe/struct.ServerOptions.html)), and an explicit DACL for the current user via `create_with_security_attributes_raw`. The explicit DACL is required: the default named pipe descriptor grants "read access to members of the Everyone group and the anonymous account" ([Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights)).
- **Relay.** Rust reads lines from the socket and hands them to the webview through a Tauri channel tagged with a connection id; the webview's MCP Worker answers on the same channel. Rust does not parse MCP; it enforces a maximum line length and a per-connection rate limit, which is where #389 decision 4's runtime budget applies.
- **Bridge binary.** A separate console binary, shipped next to the app (Tauri `externalBin`). It cannot be the app binary with a flag: `tauri-plugin-single-instance` makes a second launch "send a request to the service to notify the first instance, and exit right away" ([single-instance](https://v2.tauri.app/plugin/single-instance/)), and the release binary has no console on Windows. The bridge reads `MAIBUK_MCP_TOKEN` from its environment (the spec's stdio credential path, 1.3) and sends it as the first line; it exits when stdin closes.
- **App not running.** The bridge cannot reach the Library without the app (option C is rejected). It answers `server/discover` and `initialize` itself, then returns every tool call as a tool error that says "Maibuk is not running. Open Maibuk and turn on Settings → Connected agents" (exact copy for #404). Launching the app hidden (`--minimized`, already used by autostart, `src-tauri/src/lib.rs:46,83`) is possible but is a product decision for #404, not a requirement.
- **Zero cost when off.** No listener, no Worker, no SDK in the main bundle. The TS SDK is loaded the first time a paired client connects. The SDK's bundle size in the web build is not measured (see log).

## 4. Android and web

**Android.** `rmcp` or a Rust listener would compile for Android, but there is nothing to talk to: no MCP client is known to run on Android and launch or connect to a local server (unverified), and the desktop single-instance and tray machinery does not exist there (`src-tauri/Cargo.toml` puts both under `cfg(not(any(target_os = "android", target_os = "ios")))`). Serving a desktop agent from the phone over Wi-Fi would make Maibuk a network server; the spec expects OAuth 2.1 for that (1.3). Not for v1. #389 decision 5 ("every platform") applies to Plugins; the MCP server is a desktop integration point and its manifest-style `platforms` would be `["desktop"]`.

**Web.** No local server is possible. WebMCP lets a page register tools for "AI agents, including those built into the browser, hosted in iframes, or running in extensions" (WebMCP README), and its status page lists an origin trial in Chrome 149 and Edge 150, experimental Brave support, ChatGPT Desktop support, and only standards-position requests for Firefox and Safari ([implementation status](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md)). If it ships, the same generated tool table (section 6) could register through it on the web build, since the tools already run in the webview. Track it; do not build it now.

## 5. Security

### 5.1 Threat model

What the design defends against, in order of likelihood:

1. **A confused agent.** The agent reads text it should not obey (a Note with pasted web content, a Chapter with an instruction in it) and calls write tools. This is the main risk and the reason writes need more than a token.
2. **An unapproved client.** Any tool the author installs can try to connect.
3. **A web page.** DNS rebinding against a localhost port. Removed by not opening a port (3.2, option D).
4. **Another local account or a remote machine.** Removed by socket mode `0600` and the pipe DACL plus remote rejection.

Out of scope: malware running as the author's own account. It can already read and write `maibuk.db`; the socket gives it nothing it lacks.

`clientInfo` in the MCP request is self-reported, so it labels a client and never authenticates one. On Linux, `SO_PEERCRED` and on Windows `GetNamedPipeClientProcessId` give the bridge's PID; its parent process name can be shown in the approval dialog as information, never as identity.

### 5.2 Minimum model to ship

1. **Off by default**, enabled in Settings, with the listener bound only while enabled.
2. **Pairing per client.** The author presses "Connect an agent", names it, picks permissions, and Maibuk shows the one-line config for Claude Code, Claude Desktop, and Cursor with a fresh random token in `MAIBUK_MCP_TOKEN`. Maibuk stores only the token's hash. A connection whose first line is not a known token is closed before any MCP message is parsed.
3. **Grants use the Plugin grant storage** (#389 decision 8): each paired client is listed beside Plugins with the same plain-language permissions and is revocable the same way; a revoked call returns a tool error, the connection stays up.
4. **Exposed permissions are a subset.** `library:read` and `library:write` only. Never `secrets` (the agent must not see BYOK keys), `process`, `network` (the agent has its own), `clipboard`, or any UI or editor-selection method.
5. **Writes are visible.** At minimum a per-call confirmation in Maibuk for write tools unless the author turned it off for that client, or a Checkpoint before the first agent write to a Book in a session. Which one is #404's call; shipping with neither fails the spec's "human in the loop" (1.4) on Maibuk's side.
6. **Tutorial.** While `isTutorialLibraryActive()` is true every tool call returns "Maibuk is showing the Tutorial", reads included, because `getDatabase()` returns the in-memory Tutorial Library then (ADR 0008) and an agent would read sample content as the author's. This joins the AGENTS.md list of jobs that check the switch, with its test.
7. **Audit log.** Device-local, not synced, not in Backups: time, client name, tool, entity ids, outcome. Never content, matching the Sync logging rule in AGENTS.md ("Never log note content"). Shown in the client's Settings row.
8. **Budget.** Line size cap and per-client rate limit in the Rust relay; the MCP Worker gets the Plugin runtime budget (#401).

## 6. One source of truth for tools, and two platform gaps

**Generation.** If #396 defines each Plugin API method as data (id, description, input and output JSON Schema, required permission, effect), the MCP tool list is a deterministic projection: filter by the exposable permissions in 5.2, map `effect: "read"` to `readOnlyHint: true` and deletes to `destructiveHint: true`, and return tools in a stable order (the spec now says servers "SHOULD return tools from `tools/list` in a deterministic order", changelog minor change 3). Methods that only make sense inside Maibuk (render a UI tree, subscribe to the editor selection, register a Command) are excluded by their permission or by a flag. A gate test compares the projection with a snapshot so a new API method is a deliberate MCP decision. This asks one thing of #396: keep the method table as data with JSON Schema, not only as TypeScript types.

**Gap 1, stale views on local writes from outside a store.** `src/features/sync/view-refresh.ts:4-6` says "Local Changes need no refresh here: the writing store already updated its own view", and line 67 returns early for local Changes. An agent (or a Plugin) writing through `write.ts` emits a local Change without passing through a store, so Galleries stay stale and, worse, an open Chapter's Edit Session can save over the agent's text on the next keystroke. This is a Plugin platform problem first (#396 / #398); MCP makes concurrent edits likely. The fix needs a way for view refresh to tell "local, from a store" apart from "local, from a Plugin", which is a Change Feed contract change, so it belongs in an ADR.

**Gap 2, attribution.** `ChangeOrigin` is `"local" | "remote"` (`change-feed.ts:15`). Whether agent writes get an actor field (for the audit log and for Checkpoint labels) is #404's question; adding a value to Origin would conflate "which device" with "who on this device".

## 7. Effort

| Piece | Size | Note |
| --- | --- | --- |
| Rust listener + relay (Unix socket, named pipe with DACL, connection ids, caps) | M | Two OS-specific code paths, tests per OS |
| `maibuk-mcp` bridge binary + packaging (deb, rpm, AppImage, Windows installer) | S | Bundling a second binary in four package formats is the bulk |
| MCP Worker on the TS SDK with the generated tool table | S | Given #396's method table |
| Pairing, grants, Settings rows, audit log, Tutorial guard | M | Reuses Plugin grant storage and the Settings row declarations (ADR 0018) |
| Tests: protocol (both eras), permission refusals, Tutorial refusal, revocation, E2E row | S-M | E2E cannot drive an external agent; a test client from the TS SDK over the socket can |
| **Total, after the Plugin platform** | **M** | |
| Echoes pilot (platform + Plugin) | L | For comparison: sandbox, reconciler, manifest, contributions, grants |

Before the platform exists the MCP server is L, since it would have to invent the API, grants, and approval UI that the pilot builds.

## Implications for Maibuk

- **For #404:** recommend "later, right after Echoes", desktop only, stdio through the bridge, tools generated from #396. Decide there: per-call confirmation vs. Checkpoint before agent writes, the glossary term, the not-running behavior, and the actor field.
- **For #396:** keep the API method table as data with JSON Schema and an effect field, so MCP and any future WebMCP registration are projections of it.
- **For #396 / #398:** fix view refresh for local Changes that bypass stores (Gap 1) before any Plugin gets `library:write`; Echoes is read-only, so the pilot itself is not blocked.
- **For #393:** the pairing token hash is Library-independent device state; if it lives in the keychain with Plugin secrets, the same storage serves both.

## Sources

- MCP spec 2026-07-28: [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog), [transports](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports), [stdio](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio), [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http), [authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), [versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning), [tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools). Read from `modelcontextprotocol/modelcontextprotocol` at `db788e34ffc0`, `docs/specification/2026-07-28/`.
- [Security best practices (2026-07-28)](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices), "Local MCP Server Compromise".
- [Connect to local MCP servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers) (Claude Desktop).
- [Claude Code MCP docs](https://code.claude.com/docs/en/mcp).
- [Cursor MCP docs](https://cursor.com/docs/context/mcp).
- [rust-sdk](https://github.com/modelcontextprotocol/rust-sdk) `rmcp-v3.5.0`: `crates/rmcp/Cargo.toml`, `crates/rmcp/src/model.rs`, `crates/rmcp/src/transport/streamable_http_server/tower.rs`.
- [typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) `v2.3.0` release notes; `docs/advanced/custom-transports.md`, `docs/protocol-versions.md`, `docs/get-started/packages.md`.
- [mcpb](https://github.com/modelcontextprotocol/mcpb) README.
- [WebMCP](https://github.com/webmachinelearning/webmcp) README and implementation status.
- [Tauri single-instance plugin](https://v2.tauri.app/plugin/single-instance/).
- [tokio named pipe ServerOptions](https://docs.rs/tokio/latest/tokio/net/windows/named_pipe/struct.ServerOptions.html), [Named Pipe Security and Access Rights](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights).
- Maibuk at `bed1e51d`: `src-tauri/src/lib.rs`, `src-tauri/src/main.rs`, `src-tauri/Cargo.toml`, `src/features/sync/change-feed.ts`, `src/features/sync/view-refresh.ts`, ADRs 0003, 0005, 0008, 0017.

## Verification log

Checked:

- Spec revision and release dates: `gh api repos/modelcontextprotocol/modelcontextprotocol/releases` (2026-07-28 published 2026-07-28T16:47Z).
- Spec quotes: read from the raw `.mdx` files at `db788e34ffc0`, not from a summary.
- SDK maintenance: `gh api` repo and release metadata on 2026-10-02; `rmcp` protocol constants read from `model.rs` on main.
- Maibuk facts: read from the files cited at `bed1e51d`.

Not verified, and what would settle it:

- **Which protocol era each client speaks today** (Claude Desktop, Claude Code, Cursor). Settles by running a dual-era test server and logging the first request from each. Does not change the design.
- **Claude Desktop accepting a local HTTP `url` entry** in `claude_desktop_config.json`. Only the stdio form is documented on the page read. Irrelevant if stdio is used.
- **No MCP client on Android that uses local servers.** Settles with a survey of Android agent apps. Even if one exists, the background-execution limits stand.
- **Cursor and Claude Code passing `env` to stdio servers on Windows** the same way as on Linux. Cursor's page documents `env`; Claude Code documents `--env`. A Windows smoke test settles it.
- **TS SDK bundle cost** in the web build (it pulls Zod schemas through `@modelcontextprotocol/core`). Settles with `pnpm build:web` and a bundle diff; mitigated by lazy loading.
- **GUI-subsystem binary with inherited stdio on Windows.** Avoided by the separate console bridge, so not tested.
