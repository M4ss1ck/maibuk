# Maibuk MCP server: token-efficient tool design

Research date: 2026-10-20, for issue #412. This report does not re-open what `docs/research/plugins-mcp-feasibility.md` (2026-10-02, for #394) settled: stdio through a `maibuk-mcp` bridge, the TS SDK in a webview Worker, the Plugin API as the only path to the Library, desktop only, tools projected from the Plugin API table. It asks one further question: what the projected surface should look like so a client model spends as few tokens as possible and still gets the features an author actually wants. Maibuk code is cited at `0577bedacd02fd926c15b7401ab5431ba1eb6b53`.

Pinned sources:

| Source | Ref |
| --- | --- |
| MCP specification | revision `2026-07-28`, pages `server/tools`, `server/resources`, `server/prompts`, `server/discover`, `server/utilities/pagination`, `server/utilities/caching`, `basic/patterns/mrtr`, `changelog`, read 2026-10-20 |
| MCP Skills extension | `extensions/skills/overview`, SEP-2640 Final; `extensions/client-matrix`, read 2026-10-20 |
| Anthropic, "Writing effective tools for agents" | published 2025-09-11 |
| Anthropic, "Code execution with MCP" | published 2025-11-04 |
| Anthropic, "Introducing advanced tool use" | published 2025-11-24 |
| Claude platform, "Tool search tool" | tool versions `tool_search_tool_regex_20251119`, read 2026-10-20 |
| Claude Code, MCP and env-var reference | read 2026-10-20, page cites Claude Code v2.1.296 |
| Cursor, MCP docs | read 2026-10-20 |
| Cloudflare, "Code Mode: the better way to use MCP" | published 2025-09-26 |
| Notion MCP tool reference | read 2026-10-20 |
| Google Drive MCP reference | page last updated 2026-07-16 |
| GitHub MCP server README and remote-server docs | `github/github-mcp-server` main at `e3809fe9` (2026-10-15) |
| Linear MCP docs | read 2026-10-20 |
| `mcp-obsidian` | `MarkusPfundstein/mcp-obsidian` main, 4,482 stars, last push 2026-08-31 |
| OpenAI, MCP server and plugin build guides | read 2026-10-20 |
| Maibuk | `src/features/plugins/api-table.ts`, `src/features/command-palette/palette-index.ts` at `0577bed` |

---

## Summary

**Verdict.** Ship ten tools, two resource templates, and three prompts, and treat response shape, not definition size, as the main token problem. The strict projection of the Plugin API table gives 32 tools for roughly 6,000 tokens of definitions; the subset Maibuk can expose under `library:read` and `library:write` is 11 tools for roughly 2,100. Ten task-shaped tools cost about 1,500 and, more importantly, keep Maibuk's share of a session's toolset small enough that tool selection stays accurate. The largest avoidable cost sits in results: `library.notes.list` and `library.books.list` are unbounded ([`api-table.ts:160`](src/features/plugins/api-table.ts), [`api-table.ts:132`](src/features/plugins/api-table.ts)), and `library.chapters.get` returns every Chapter as both plain text and sanitized HTML ([`api-table.ts:155`](src/features/plugins/api-table.ts)). A 2,000-Note Library moves about 90,000 tokens through one `notes.list` call, against a 25,000-token ceiling in Claude Code.

Four judgments follow from the sources, and each one changes a design decision:

1. **Definition cost is now partly hidden, not gone.** Claude Code defers MCP tools by default through tool search and loads only names plus server instructions ([Claude Code MCP](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search)). Cursor's docs describe no such mechanism ([Cursor MCP](https://cursor.com/docs/context/mcp)). Any claim that definitions no longer matter is true only for one client.
2. **Tool count still matters even when definitions are deferred**, because selection accuracy degrades past 30 to 50 tools in the model's whole toolset, not just in one server's ([tool search docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)).
3. **Code mode does not apply to a local stdio Library server in v1.** It is a client capability that a server cannot adopt, and the server-side version would put arbitrary JavaScript behind `library:write`.
4. **The projection rule survives if it is restated.** "One row equals one tool" cannot produce a token-efficient surface. "Every tool is one row or a declared composition of rows, rendered through a named output view" can, and keeps the gate test meaningful.

| Surface | Tools | Rough definition tokens | Where it sits |
| --- | --- | --- | --- |
| Strict projection of the whole table | 32 | ~6,000 | Past the 30 to 50 accuracy cliff once file, shell, and web tools are counted |
| Exposable subset (`library:read`, `library:write`) | 11 | ~2,100 | Workable, but four read/list pairs overlap |
| **Recommended v1** | **10** | **~1,500** | Fits a writer's session with room to spare |

---

## 1. Tool-surface size

### 1.1 What definitions cost

Anthropic measured the cost directly: GitHub 35 tools at about 26K tokens, Slack 11 at about 21K, a five-server setup of 58 tools at about 55K, and an internal case at 134K tokens before optimization ([advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)). That is 400 to 2,000 tokens per tool, with wide variance from schema depth. The same post says tool definitions can push a session toward "100K+ token overhead". The tool search documentation repeats the figure: "A typical multiserver setup (GitHub, Slack, Sentry, Grafana, and Splunk) can consume ~55k tokens in definitions before Claude does any work" ([tool search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)).

Maibuk's own table is much cheaper per tool, because its schemas are flat: id strings, titles, counts, timestamps. Estimating from the Zod definitions, a tool with one or two parameters and one output object lands at 130 to 240 tokens. The 32-row projection is therefore about 6K, the 11-row library subset about 2.1K, and a ten-tool surface about 1.5K. These are character-count estimates at four characters per token, not measurements (see the verification log).

### 1.2 How clients handle many tools today

**Claude Code** runs tool search by default. "Only tool names and server instructions load at session start, so adding more MCP servers has minimal impact on your context window. Claude Code doesn't impose a fixed per-server tool cap; the practical limit is your context window budget" ([MCP docs](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search)). It also truncates what the model sees: 4,096 characters for server instructions and for any tool description that loads upfront, 16,384 for a description loaded through tool search. Since search matches against the description, "it reads only the part within the shorter limit, so put the words Claude would search for near the start" (same page). A server can ask for individual tools to stay loaded with `_meta["anthropic/alwaysLoad"]: true`, and the person configuring the server can override it.

**The Claude API** takes the other half of the same design: `defer_loading: true` on tool definitions, a `tool_search_tool_regex_20251119` or `tool_search_tool_bm25_20251119` search tool, up to 10,000 deferred tools per request, five results per search by default, and a stated policy for when it pays: "Use tool search when ... You have 10 or more tools available ... Your tool definitions consume more than 10k tokens", and prefer plain tool calling "when you have fewer than 10 tools" ([tool search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)). Deferred definitions stay out of the prompt, so prompt caching is unaffected ([advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)).

**Cursor** documents no deferred loading and no tool cap on its MCP page as of 2026-10-20; it documents approval prompts and a capability table with Tools, Prompts, Resources, Roots, Elicitation and Apps all supported ([Cursor MCP](https://cursor.com/docs/context/mcp)). The 40-tool ceiling is real in field reports: Cursor's own forum carries a screenshot of the warning "You have 50 tools from enabled servers. The limit is 40 tools" ([forum, 2025](https://forum.cursor.com/t/mcp-server-40-tool-limit-in-cursor-is-this-frustrating-your-workflow/81627)). Whether that ceiling still exists in current builds is unverified; the safe reading is that Cursor pays the full definition cost and may cut the list.

**Claude Desktop** appears in no tool-search documentation I found. Inference, not a sourced claim: it loads definitions upfront, which makes it the client where Maibuk's 6K projection is actually charged.

### 1.3 Few coarse tools or many fine tools

Anthropic's guidance is to build for workflows rather than endpoints: "Instead of implementing a `list_users`, `list_events`, and `create_event` tools, consider implementing a `schedule_event` tool"; "Instead of implementing a `read_logs` tool, consider implementing a `search_logs` tool"; "Instead of implementing `get_customer_by_id`, `list_transactions`, and `list_notes` tools, implement a `get_customer_context` tool" ([writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents)). The stated mechanism is that consolidation "reduce[s] the number of tools and tool descriptions loaded into the agent's context and offload[s] agentic computation from the agent's context back into the tool calls themselves."

OpenAI's build guide pushes back on the extreme reading: "Create one tool for each distinct action the plugin must support. Prefer focused operations such as `list_projects`, `get_project`, and `update_project` over one tool with many unrelated modes" ([OpenAI, build an MCP server](https://developers.openai.com/plugins/build/mcp-server.md)). Its knowledge-connector shape is narrower still: "two read-only tools: `search` and `fetch`" ([OpenAI MCP](https://developers.openai.com/api/docs/mcp.md)).

The first-party servers split the difference by domain size. Google Drive exposes eight tools (`search_files`, `read_file_content`, `get_file_metadata`, `list_recent_files`, `get_file_permissions`, `create_file`, `copy_file`, `download_file_content`) ([Drive MCP reference](https://developers.google.com/workspace/drive/api/reference/mcp)). `mcp-obsidian` exposes seven: list files, list a directory, get contents, search, patch relative to a heading, append, delete ([README](https://raw.githubusercontent.com/MarkusPfundstein/mcp-obsidian/main/README.md)). Notion exposes roughly 25 content tools plus Skills, memory, sessions and file tools ([Notion tools](https://developers.notion.com/guides/mcp/mcp-supported-tools)). GitHub exposes many more, split into toolsets with a default set of five.

Recommended counts, synthesised: 2 to 4 tools for a single-purpose connector, 6 to 12 for a single-domain app like Maibuk, and treat 30 as the point where a server should be split or made searchable. Maibuk's 32-row projection is over that line before any other server is added.

---

## 2. Code mode and code execution

Anthropic's case: presenting MCP servers as a file tree of typed functions and letting the agent write code "reduces the token usage from 150,000 tokens to 2,000 tokens", because the agent reads only the definitions it needs and filters results before they reach the model ([code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)). The same post lists alternatives that need no sandbox, notably a `search_tools` tool with a detail level (name only, name and description, full schema). Cloudflare's version converts the tool schemas into a TypeScript API and gives the agent "just one tool, which simply executes some TypeScript code", run in an isolate whose only outside access is the MCP bindings ([Cloudflare Code Mode](https://blog.cloudflare.com/code-mode/)). Anthropic's Programmatic Tool Calling is the API-level version and reports average usage dropping "from 43,588 to 27,297 tokens, a 37% reduction on complex research tasks" ([advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)).

Does it apply to a local stdio server like Maibuk's? In v1, no, for four reasons.

1. It is a client decision. Cloudflare's sandbox and Anthropic's `code_execution_20250825` tool both live in the harness. An MCP server cannot turn them on; it can only shape its schemas so they read well as code. Claude Code already has a shell and a file editor, and uses them against CLIs, not against MCP servers.
2. The only server-side variant is an `execute` tool, and that puts arbitrary JavaScript inside the MCP Worker with the client's `library:write` grant. The code would bypass the per-method permission checks the broker performs, or would re-implement them inside an interpreter. Anthropic is explicit that this needs "a secure execution environment with appropriate sandboxing, resource limits, and monitoring" (code execution post).
3. The saving is small at Maibuk's size. Code mode pays when definitions run to tens of thousands of tokens; Maibuk's ten tools are about 1,500.
4. The multi-step workflows that benefit most, such as "rename a character across 40 Chapters", are better served by one search tool plus one write tool than by an interpreter, and they are exactly the workflows that need a Checkpoint before they run.

Revisit the question if the surface passes about 25 tools (Versions, Canvas, Export, Character and Location once the Story Bible exists), or if a client ships code mode as a transport-level feature for local servers. Until then, `search_library` is the practical substitute: it keeps the model from enumerating the Library, which is the part of code mode that saves the most tokens.

---

## 3. Response shaping

### 3.1 The limits that actually bite

Claude Code: "Claude Code displays a warning when any MCP tool output exceeds 10,000 tokens", the default maximum is 25,000 tokens via `MAX_MCP_OUTPUT_TOKENS`, a successful text result over 50,000 characters is written to a file and replaced by its path, and a tool can raise its own ceiling with `_meta["anthropic/maxResultSizeChars"]` up to 500,000 characters ([MCP output limits](https://code.claude.com/docs/en/mcp#mcp-output-limits-and-warnings), [env vars](https://code.claude.com/docs/en/env-vars.md)). Error text over about 11,000 characters keeps its first 5,000 and last 5,000 with a marker between them. HTTP and SSE responses over 16 MiB fail outright.

Anthropic's tool guidance adds the shaping rules: "implement some combination of pagination, range selection, filtering, and/or truncation with sensible default parameter values for any tool responses that could use up lots of context", and when truncating, "steer agents with helpful instructions" ([writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents)). The `response_format` enum with `concise` and `detailed` is shown cutting a response from 206 to 72 tokens, about a third.

### 3.2 What the protocol gives you

Pagination is cursor-based, server-sized, with an opaque `nextCursor`; clients must treat cursors as opaque and must not assume a page size ([pagination](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/pagination)). Tools, prompts, resources and resource templates all paginate.

`structuredContent` is a JSON value that must conform to `outputSchema` when one is declared, and "for backwards compatibility, a tool that returns structured content SHOULD also return the serialized JSON in a TextContent block" ([tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)). That SHOULD is a doubled bill: the same data once as text and once as structure. OpenAI's guide tells servers to do exactly that, duplicating the JSON in the content array ([OpenAI MCP](https://developers.openai.com/api/docs/mcp.md)). A prose-heavy tool such as "read this Chapter" should therefore declare no output schema at all.

A tool can also return `resource_link` items, which carry a URI the client can fetch or subscribe to, or embed a whole resource; links are cheaper by definition because the body is not in the result ([tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)).

Notion shows the truncation-with-hints pattern in production: `notion-fetch` sets `truncated: true`, returns up to 50 `unknown_block_ids` and a total count, and accepts one of those IDs back to fetch that subtree ([Notion tools](https://developers.notion.com/guides/mcp/mcp-supported-tools)).

### 3.3 Maibuk's actual exposure

Three rows in the Plugin API guarantee a blowout if projected as they are:

- `library.books.list` takes no input and returns every Book ([`api-table.ts:132`](src/features/plugins/api-table.ts)).
- `library.notes.list` takes an optional `bookId` and returns every Note summary, with no limit, offset or cursor ([`api-table.ts:160`](src/features/plugins/api-table.ts)).
- `library.chapters.get` returns `text` and `html` together for the whole Chapter ([`api-table.ts:155`](src/features/plugins/api-table.ts)).

A Note summary is about 45 tokens (id, bookId, title, language, tags, word count, timestamp). One thousand Notes is 45K tokens, two thousand is 90K, against a 25K ceiling. A 6,000-word Chapter is about 8,000 tokens as text and rather more as HTML; a Chapter read that returns both is the single most expensive call in the proposed surface, and the HTML half is usually useless to a model that will re-emit text.

Conventions Maibuk should adopt, each with its source:

| Convention | Detail | Why |
| --- | --- | --- |
| Bounded lists | `limit` default 20, max 50, plus `nextCursor` and `total` | Spec pagination; Anthropic's pagination guidance |
| No total scans | `search_library` before `list_*`; list tools require a scope (`bookId`, `tag`, `updatedSince`) | Anthropic's `search_contacts` over `list_contacts` |
| One representation | `format: "text" | "html"`, default `text` | Halves the largest responses |
| Windows for prose | `read_chapter` with `offset` and `maxChars` (default 20,000 characters) and a result of `{text, offset, nextOffset, totalChars, truncated}` | Range selection plus a hint the model can act on |
| Summaries carry ids | summaries return id, title, counts, timestamps only; bodies need a second call | Anthropic: return high-signal fields, resolve ids to names |
| No output schema on prose | `read_chapter` and `read_note` return text content and no `structuredContent` | Avoids the duplicated-JSON SHOULD |
| Small structured results | summary tools declare `outputSchema` and return a one-line text summary plus `structuredContent` | Gives ids for follow-up calls without doubling a large payload |
| Links for big bodies | a Chapter reference in `get_book` can be a `resource_link` rather than inline text | Cheaper until fetched |

---

## 4. Naming, descriptions, annotations

**Names.** Tool names are 1 to 128 characters, case-sensitive, limited to `A-Z a-z 0-9 _ - .`, unique within a server, and returned in a deterministic order, which the spec ties to prompt-cache hits ([tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)). The spec also tells clients to disambiguate across servers by prefixing with a server identifier, and Claude Code does: `mcp__maibuk__read_chapter`, with `mcp__plugin_<plugin>_<server>__<tool>` for plugin-bundled servers ([MCP docs](https://code.claude.com/docs/en/mcp#plugin-mcp-tool-names)). A `maibuk_` prefix inside the tool name is therefore wasted characters and a redundant token in every search.

Anthropic recommends namespacing by service and resource and reports that "selecting between prefix- and suffix-based namespacing" has measurable effects on evaluations ([writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents)). For one server with ten tools, verb-first names that mirror the author's vocabulary do the same job: `read_chapter`, not `library_chapters_get`.

**Descriptions.** Two limits govern them. Claude Code truncates server instructions and upfront tool descriptions at 4,096 characters and search-loaded descriptions at 16,384, and search reads only the first 4,096 ([MCP docs](https://code.claude.com/docs/en/mcp#for-mcp-server-authors)). Anthropic's advice is to write for "a new hire on your team", name parameters unambiguously (`user_id`, not `user`), and add examples where schemas leave ambiguity ([writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents)). OpenAI's version adds that descriptions should say when to use the tool, and that names, descriptions, schemas and annotations are "part of the plugin's user-facing behavior" ([OpenAI](https://developers.openai.com/plugins/build/mcp-server.md)).

Maibuk has a domain-language obligation here that most servers do not: `GLOSSARY.md` forbids "project", "manuscript", "workspace" and "account" for Book and Library concerns. Tool descriptions are where the model learns that vocabulary, so they should use Library, Book, Chapter, Note, Canvas, Tag, Version, Checkpoint, and should say in the server instructions that these are the author's words.

**Annotations.** Tools carry optional `annotations`, and clients "MUST consider tool annotations to be untrusted unless they come from trusted servers" ([tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)). The four hints in use are `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint`, usually with `title`; OpenAI's example sets three of them on a read tool ([OpenAI](https://developers.openai.com/plugins/build/mcp-server.md)). Notion uses the mechanism for approvals: its delete tools are "marked destructive (`destructiveHint: true`), so MCP clients that honor tool annotations ask before running it", and they additionally require `user_confirmed: true` in the arguments ([Notion tools](https://developers.notion.com/guides/mcp/mcp-supported-tools)). That two-layer pattern is the one to copy: the annotation is a hint to a client that may ignore it, and the argument is an enforced gate on the server.

Claude Code's documented approval model is per-tool permission rules, not annotations ([MCP docs](https://code.claude.com/docs/en/mcp)), and Cursor "asks for approval before using MCP tools by default" ([Cursor](https://cursor.com/docs/context/mcp)). Neither is Maibuk's guard; the feasibility doc's own confirmation and Checkpoint rules stay.

`projectMcpTools` currently sets one annotation from the effect column: `annotations: { readOnlyHint: row.effect === "read" }` ([`api-table.ts:558`](src/features/plugins/api-table.ts)). That is too coarse in both directions:

- `editor.reveal` is `effect: "read"` ([`api-table.ts:251`](src/features/plugins/api-table.ts)) but scrolls the editor and moves the caret. Claiming `readOnlyHint: true` for it is false in the spec's sense of not modifying the environment.
- Replacing a Chapter's text is destructive in the everyday sense even though nothing is deleted. `chapters.updateContent` and `notes.update` should carry `destructiveHint: true` and `idempotentHint: true`, since a repeat with the same input lands the same state.

A three-column mapping (read-only, destructive, idempotent) beside `effect` fixes this and keeps the gate test mechanical.

---

## 5. Resources and prompts versus tools

The spec's own division: tools are model-controlled, resources are application-driven, prompts are user-controlled ([server concepts](https://modelcontextprotocol.io/docs/learn/server-concepts.md)). Resources have URIs, templates, annotations for audience and priority, and optional subscriptions ([resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources)).

Which clients surface them today:

| Client | Resources | Prompts | Evidence |
| --- | --- | --- | --- |
| Claude Code | Yes, `@server:protocol://path` mentions, fuzzy searchable, and "Claude Code automatically provides tools to list and read MCP resources when servers support them" | Yes, listed as `/servername:promptname (MCP)` and callable as `/mcp__server__prompt` | [MCP docs](https://code.claude.com/docs/en/mcp#use-mcp-resources) |
| Cursor | Declared supported ("Structured data sources that can be read and referenced") | Declared supported | [Cursor](https://cursor.com/docs/context/mcp) |
| Claude Desktop | Not documented on the pages read; the Skills client matrix lists no Skills support | Not documented here | [client matrix](https://modelcontextprotocol.io/extensions/client-matrix.md) |

Skills over MCP is the newest route: a server declares `resources` plus the `io.modelcontextprotocol/skills` extension, implements `skills/list` and `skills/get`, and serves `SKILL.md` plus files through `resources/read`, so instructions load "only when needed" ([skills overview](https://modelcontextprotocol.io/extensions/skills/overview.md)). The client matrix shows Skills support for `mcpc`, partial support in ChatGPT, fast-agent and the Inspector, and none listed for Claude Desktop, Cursor or Claude Code ([matrix](https://modelcontextprotocol.io/extensions/client-matrix.md)). Maibuk should not build on it yet.

**Do chapters as resources save tokens?** Only in one specific way. A resource costs nothing in `tools/list`, so moving Chapter bodies out of tool definitions saves nothing (there are no Chapter bodies in definitions today). What it does save is a tool slot and the choice between `read_chapter` and a link. Against that: the model's access to resources is indirect, through a generic list/read tool the client supplies, and the list itself has a cost. Listing 500 Chapters as resources at about 40 tokens each is 20K tokens, worse than any tool. The shape that works is a Book-level resource plus a template: `maibuk://book/{bookId}` for one Book's outline, `maibuk://chapter/{chapterId}` and `maibuk://note/{noteId}` as templates rather than enumerated resources. Notion uses resources for exactly this kind of load: long reference documents that no tool description should carry (`notion://docs/view-dsl-spec`, `notion://docs/memory`).

**Prompts.** Zero cost until invoked, user-controlled, and useful for text-heavy workflows that would otherwise bloat a description. Three are worth shipping: `continue_chapter` (given a chapter id, load the last N words and the Book's notes), `critique_chapter`, and `outline_book`. None of them is a token lever for the model; they are a discovery and consistency lever for the author.

---

## 6. What revision 2026-07-28 changes for token efficiency

**`server/discover`.** Servers "MUST implement it"; the result carries `supportedVersions`, `capabilities`, `serverInfo`, an optional `instructions` string, and `ttlMs`/`cacheScope` ([discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover.md)). It replaces three probes with one request, and Claude Code's v2 runtime "asks HTTP, stdio, and claude.ai connector servers whether they support the newer revision" ([MCP docs](https://code.claude.com/docs/en/mcp#mcp-client-runtimes)), so the bridge must answer it on stdio, as the feasibility doc already requires.

**Caching hints are mandatory.** `server/discover`, `tools/list`, `prompts/list`, `resources/list`, `resources/templates/list` and `resources/read` must return `ttlMs` and `cacheScope` ([caching](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching.md)). For a local server whose tools change only when a grant changes, `ttlMs` of 300000 with `cacheScope: "private"` is defensible, but it must be paired with `list_changed` or a revocation would not take effect on the client's cached list.

**Lists may vary by authorization, not by connection.** `tools/list` "MUST NOT vary per-connection or as a side effect of other requests on the connection. The set MAY vary by the authorization presented on the request" ([tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)). This matters for Maibuk: a read-only mode expressed as "the client's grant is `library:read` only" is allowed and fits the pairing design, while a GitHub-style header or query flag that toggles toolsets on one connection is not. GitHub's `X-MCP-Toolsets` and `/mcp/x/<toolset>` variants predate this rule ([remote server docs](https://raw.githubusercontent.com/github/github-mcp-server/main/docs/remote-server.md)).

**Deterministic order and `list_changed`.** Tools should come back in a stable order, which the changelog says improves prompt-cache hits, and changes now arrive through `subscriptions/listen` with `toolsListChanged: true` rather than a per-connection notification ([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)). Maibuk's tool list changes only on pairing or grant edits, so this is close to a no-op, but the capability must be declared honestly.

**MRTR replaces server-initiated requests.** A server answers `tools/call`, `resources/read` or `prompts/get` with `resultType: "input_required"`, an `inputRequests` map, and an opaque `requestState` that the client echoes on retry with a new JSON-RPC id ([MRTR](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr)). Servers must not request a capability the client did not declare, must treat `requestState` as attacker-controlled, and should bind it to the principal, a short expiry and the originating request. For Maibuk: MRTR suits disambiguation ("two Books match, which one?") and is the wrong tool for write approval, because approval belongs in Maibuk's own dialog, not in the client's, and a client that does not implement elicitation would be left with no gate at all.

**`x-mcp-header`** lets a parameter travel as an HTTP header ([tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)). Irrelevant on stdio; another reason the bridge stays stdio.

---

## 7. Comparable first-party servers

| Server | Tools exposed | How it controls tokens | What its docs lead with |
| --- | --- | --- | --- |
| Notion | About 25 content tools plus memory, skills, sessions, file and comment tools ([list](https://developers.notion.com/guides/mcp/mcp-supported-tools)) | Search-first (`notion-search` with filters, 50 results max); `notion-fetch` with truncation hints; long specs in `notion://docs/...` resources; `limit` plus `nextCursor` on list tools; destructive tools gated by `user_confirmed` and annotations | "search for pages, create a page from the results, and then update page properties" |
| Google Drive | 8 tools, one per file action, grouped in toolsets ([reference](https://developers.google.com/workspace/drive/api/reference/mcp)) | "Using toolsets can help your agent perform better because it decreases the number of tools available to your agent" | Search, read, create, copy, download |
| Linear | Tool families for issues, projects, comments ([docs](https://linear.app/docs/mcp)) | A `/mcp/readonly` endpoint that "only ever exposes read tools", or a `read`-scope token; OAuth 2.1 | Roadmap planning, standup updates, bug investigation: create and update flows |
| GitHub | Many tools across 20-plus toolsets ([README](https://raw.githubusercontent.com/github/github-mcp-server/main/README.md)) | Toolsets, per-tool allowlists, `--read-only` that overrides explicit tool requests, per-toolset URLs and headers; "Enabling only the toolsets that you need can help the LLM with tool choice and reduce the context size" | Repository and issue workflows |
| Obsidian (`mcp-obsidian`, 4,482 stars) | 7 tools ([README](https://raw.githubusercontent.com/MarkusPfundstein/mcp-obsidian/main/README.md)) | No pagination, no shaping; a plain file model | "Search for all files where X is mentioned", "summarize the last meeting notes and put them into a new note" |

Three patterns transfer to Maibuk.

1. **Search before read.** Four of the five lead with search or fetch as the entry point, and OpenAI makes the pair mandatory for knowledge connectors. Maibuk's table has no search row at all.
2. **A read-only surface is a grant, not a flag.** Linear ships a separate endpoint and a scope; GitHub ships `--read-only` that beats an explicit tool request. Maibuk's per-client grants already express this, and the 2026-07-28 rule that lists may vary by authorization makes the grant the correct mechanism.
3. **Patch rather than replace.** Obsidian's `patch_content` inserts "relative to a heading, block reference, or frontmatter field" ([README](https://raw.githubusercontent.com/MarkusPfundstein/mcp-obsidian/main/README.md)). For a writer, adding a scene to the end of a Chapter without reading the Chapter is the single highest-value write, and it costs about 40 tokens instead of 8,000.

---

## 8. Recommendation for Maibuk

### 8.1 v1 tool list

Ten tools, all under `library:read` or `library:write`, named verb-first with no redundant prefix.

| Tool | Effect | Returns | Rows | Rough tokens |
| --- | --- | --- | --- | --- |
| `search_library` | read | Hits across Books, Chapters, Notes: `{kind, id, bookId, title, snippet, score}`, `limit` default 20, `nextCursor`; scopes `kinds`, `bookId`, `updatedSince` | **new row** `library.search` | ~170 |
| `list_books` | read | Book summaries: `{id, title, status, wordCount, updatedAt}`, `limit`/`cursor`, `status` filter | `library.books.list` with a view | ~140 |
| `get_book` | read | One Book plus its ordered Chapter summaries and its Note titles, no bodies | `library.books.get` + `library.chapters.list` + `library.notes.list` (composition) | ~180 |
| `read_chapter` | read | `{title, status, text, offset, nextOffset, totalChars, truncated}`, `format` text only in v1, windowed | `library.chapters.get` with a view | ~150 |
| `list_notes` | read | Note summaries, `limit`/`cursor`, filters `bookId`, `tag`, `updatedSince` | `library.notes.list` with a view | ~160 |
| `read_note` | read | Note title, tags, plain text, windowed | `library.notes.get` with a view | ~140 |
| `append_to_chapter` | write | `{wordCount, appended}` plus the new tail as a short preview; `mode: "append" | "under_heading"` | **composition** `library.chapters.get` + `library.chapters.updateContent` | ~150 |
| `update_chapter` | write | `{wordCount}`; `mode: "replace"` requires the caller to have read the Chapter in this session or pass `expectedUpdatedAt` | `library.chapters.updateContent` | ~150 |
| `create_note` | write | `{noteId, title}` | `library.notes.create` | ~140 |
| `update_note` | write | `{updatedAt}`; title or content, `mode: "replace" | "append"` | `library.notes.update` | ~130 |

Total about 1,500 tokens of definitions, nine of them on rows that already exist, one composite read, one composite write, one new row.

Why this list and not the 11-row projection: the projection's read half is four list/get pairs, which forces the model to choose between `books.list` and `books.get` when the real task is "show me this Book's Chapters". `get_book` removes that choice for one definition instead of two. Why not fewer: dropping `list_notes` or `read_note` would leave Note workflows to search snippets, and OpenAI's guidance against multi-mode tools argues the same way from the other side.

### 8.2 Resources and prompts

Resource templates, not enumerated resources: `maibuk://book/{bookId}` (Markdown outline), `maibuk://chapter/{chapterId}` (plain text, same windowing idea), `maibuk://note/{noteId}`. `resources/list` returns Books only, capped and paginated, because the author may want to attach one by mention and 500 Chapter entries would cost more than the tools. Prompts: `continue_chapter`, `critique_chapter`, `outline_book`.

Server instructions (under 500 characters, front-loaded with the words a search will match): Maibuk holds the author's Library of Books, each with ordered Chapters, plus Notes and Canvases; use `search_library` first; every write goes through the author's Book and Chapter write paths and may be refused while the Tutorial runs.

### 8.3 Response conventions

1. Default `limit` 20, maximum 50, `nextCursor` and `total` on every list.
2. Plain text by default; HTML only when the caller asks; never both.
3. Prose tools carry no `outputSchema` and no `structuredContent`.
4. Summary tools carry `outputSchema` and return a one-line text summary beside the structure.
5. Truncation always returns `truncated`, `nextOffset` and `totalChars`, and the description says what to do next.
6. Timestamps as ISO 8601 strings, not epoch milliseconds: shorter, and the model reads them without arithmetic. `api-table.ts` uses epoch millis for `updatedAt` ([`api-table.ts:51`](src/features/plugins/api-table.ts)); a view can convert.
7. No field a follow-up call cannot use. `language`, `html`, and `parentId` (always null today, [`api-table.ts:75`](src/features/plugins/api-table.ts)) are candidates to drop from summaries.
8. Errors are tool results with `isError: true` and a sentence the model can act on, per the spec's split between protocol errors and execution errors ([tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)).

### 8.4 What to defer, and why

| Deferred | Reason |
| --- | --- |
| `editor.*` (getContent, getSelection, insert, replace, setHighlights, reveal) | The target is "the rich-text editor that last took focus" ([`api-table.ts:219`](src/features/plugins/api-table.ts)); outside Maibuk that is undefined, and `reveal` is mislabelled as read-only. `editor:read` is already outside the exposable permission set. |
| `navigation.*` | Moves the author's screen under them while an agent works. No token case for it, and no consent model in v1. |
| `storage.*`, `secrets.*`, `network.*`, `clipboard.*`, `notifications.*`, `toolbar.*` | Outside `library:read`/`library:write`, as the feasibility doc already rules. |
| Canvas | The API exposes metadata only ([`api-table.ts:176`](src/features/plugins/api-table.ts)), so a tool can say a Canvas exists and nothing more. Revisit when Canvas content enters the API. |
| Versions and Checkpoints | No rows exist. High value for a writer (list Versions, compare, Restore), but Restore is destructive and needs `destructiveHint`, a Checkpoint first, and the feasibility doc's write-visibility decision. |
| `outputSchema` on prose tools, `alwaysLoad`, code mode, Skills extension | Cost without benefit at this size, or client support that does not exist (Skills matrix). |

### 8.5 Conflicts with the "tools are a projection of the method table" rule

Four, all fixable in #396 rather than in #412.

1. **Composite tools.** `get_book`, `append_to_chapter` and `search_library` cannot be one row each. The rule should become: every tool is either one row or a declared `composes: [rowIds]` entry, the composition may not exceed the union of its rows' permissions, and the gate test checks both directions (row without tool, tool without row or composition).
2. **Output views.** A tool needs to drop fields (`html`, `language`) and reshape timestamps, which the raw `outputSchema` projection forbids. A per-tool `view` validated against the row's output schema keeps one source of truth while allowing a smaller payload.
3. **A missing row.** `search_library` has no backing method. The app already has the index and the cap: `searchPalette` searches Books, Chapters, Notes and Canvases with `PALETTE_SECTION_CAP = 50` and returns scored, highlighted results ([`palette-index.ts:320`](src/features/command-palette/palette-index.ts), [`palette-index.ts:34`](src/features/command-palette/palette-index.ts)). `library.search` is a thin, read-only row over it, and without it the most valuable tool in the surface cannot exist.
4. **Annotations and names.** `effect: "read" | "write"` cannot express read-only versus destructive versus idempotent, and it gets `editor.reveal` wrong ([`api-table.ts:558`](src/features/plugins/api-table.ts)). The table needs the three hints as data, and a `toolName` override if the projection is to keep dotted ids like `library.books.list` out of the model's view.

### 8.6 What would settle the estimates

Serialize `projectMcpTools(PLUGIN_API_TABLE)` and the proposed ten tools, count with a tokenizer, and compare against a real Claude Code session with `MAX_MCP_OUTPUT_TOKENS` left at its default. For the result side, run `notes.list` against a 2,000-Note Library and read the warning threshold. For client behavior, connect the same server to Claude Code, Cursor and Claude Desktop and log the first request each sends, which is also the open question the feasibility doc left about protocol eras.

---

## Implications for Maibuk

- **For #412:** specify ten tools, three resource templates, three prompts, and the eight response conventions. Definition cost is about 1,500 tokens; the design work that pays is bounding and shaping results.
- **For #396:** add `library.search`; add `composes` and `view` to the table so a tool can span rows and drop fields; replace the single `effect` column with read-only, destructive and idempotent flags; allow a `toolName` override. Keep the gate test, but make it compare tools against rows and compositions.
- **For #404:** the read-only pairing is `library:read` only, and tools/list varying by that grant is explicitly allowed by 2026-07-28. Do not add a header or flag that changes the tool list on one connection.
- **For the MCP Worker:** answer `server/discover` with a short `instructions` string, return `ttlMs` and `cacheScope` on every list and read, keep the tool order deterministic, and emit `list_changed` through `subscriptions/listen` when a grant changes.
- **Later:** MRTR for ambiguity, Versions tools with `destructiveHint` and a Checkpoint, Canvas when its content is in the API, Skills over MCP when the client matrix fills in.

## Sources

- MCP spec 2026-07-28: [tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), [resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources), [prompts](https://modelcontextprotocol.io/specification/2026-07-28/server/prompts), [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog), [pagination](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/pagination), [caching](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching.md), [discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover.md), [MRTR](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr).
- MCP learn and extensions: [server concepts](https://modelcontextprotocol.io/docs/learn/server-concepts.md), [Skills extension](https://modelcontextprotocol.io/extensions/skills/overview.md), [extension support matrix](https://modelcontextprotocol.io/extensions/client-matrix.md).
- Anthropic: [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) (2025-09-11), [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) (2025-11-04), [Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use) (2025-11-24), [Tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool.md), [Programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling.md).
- Claude Code: [MCP](https://code.claude.com/docs/en/mcp.md), [environment variables](https://code.claude.com/docs/en/env-vars.md).
- Cursor: [MCP](https://cursor.com/docs/context/mcp), [forum report of the 40-tool warning](https://forum.cursor.com/t/mcp-server-40-tool-limit-in-cursor-is-this-frustrating-your-workflow/81627).
- Cloudflare: [Code Mode](https://blog.cloudflare.com/code-mode/).
- OpenAI: [building MCP servers](https://developers.openai.com/api/docs/mcp.md), [build a plugin MCP server](https://developers.openai.com/plugins/build/mcp-server.md).
- Notion: [MCP overview](https://developers.notion.com/docs/mcp), [supported tools](https://developers.notion.com/guides/mcp/mcp-supported-tools).
- Google: [Drive MCP reference](https://developers.google.com/workspace/drive/api/reference/mcp).
- Linear: [MCP server](https://linear.app/docs/mcp).
- GitHub: [README](https://raw.githubusercontent.com/github/github-mcp-server/main/README.md), [remote server docs](https://raw.githubusercontent.com/github/github-mcp-server/main/docs/remote-server.md), main at `e3809fe9`.
- Obsidian: [mcp-obsidian README](https://raw.githubusercontent.com/MarkusPfundstein/mcp-obsidian/main/README.md).
- Maibuk at `0577bed`: `src/features/plugins/api-table.ts`, `src/features/command-palette/palette-index.ts`, `GLOSSARY.md`, `docs/research/plugins-mcp-feasibility.md`, issue #412.

## Verification log

Checked by fetching and reading:

- Every MCP page cited, at revision `2026-07-28`; quotes on deterministic order, per-request authorization variance, `structuredContent` duplication, pagination opacity, caching fields, MRTR rules and `server/discover` are verbatim from those pages.
- Claude Code MCP page: tool search default and behaviour, 4,096 and 16,384 character limits, `anthropic/alwaysLoad`, no per-server cap, output limits section, resources and prompts sections, v2 runtime negotiation. The env-var reference confirms `MAX_MCP_OUTPUT_TOKENS` default 25,000 and the 10,000-token warning.
- Anthropic's three posts and the tool search documentation: all token figures quoted are from those pages.
- Cursor MCP page read in full; it documents no tool cap and no deferred loading.
- Cloudflare and OpenAI guides as quoted.
- Notion, Google Drive, Linear, GitHub and Obsidian pages as quoted; the Google Drive page's tool list is from its own toolset table, not a secondary source.
- GitHub repo state at `e3809fe9`, and `mcp-obsidian` star count, via the GitHub API on 2026-10-20.
- Maibuk: `api-table.ts` read in full (32 rows), `palette-index.ts` search function and caps, `GLOSSARY.md`, the feasibility doc, issue #412 via `gh issue view`.

Estimates, not measurements:

- **Definition token counts.** Derived from the Zod schemas by reading them and applying four characters per token. The method is reproducible: serialize `projectMcpTools(PLUGIN_API_TABLE)` and tokenize. Expect ±30 percent.
- **Per-result token counts** (45 tokens per Note summary, 8,000 per 6,000-word Chapter). Same method; the Note summary count follows from seven short fields.

Not verified, and what would settle it:

- **Whether Cursor still caps tools at 40 and whether it defers definitions.** The current docs are silent; the 40-tool warning is a 2025 forum report. Settles by connecting a server with 60 tools to a current Cursor build and reading the warning and the first request.
- **Claude Desktop's handling of large tool lists, resources and prompts.** Its docs were not read here. Settles by running the same server in Claude Desktop and capturing `tools/list` usage and the `@` menu.
- **Whether Claude Code reads `structuredContent` or only the text block.** The spec's backwards-compatibility sentence suggests both are needed; Maibuk's convention avoids the question for prose tools but not for summaries. Settles with two variants of one tool and a transcript comparison.
- **Whether Anthropic's API and Claude Code apply annotations to approval.** Claude Code documents permission rules, and the spec calls annotations untrusted. Settles by marking a destructive tool and observing whether either client prompts without a rule.
- **Skills over MCP client support beyond the community matrix.** The matrix is community-maintained and lists no support for Claude Desktop, Cursor or Claude Code. Settles by testing a skill-declaring server against each.


Supervisor spot-checks (2026-10-20, re-fetched independently):

- `code.claude.com/docs/en/mcp`: "Claude Code displays a warning when MCP tool output exceeds 10,000 tokens and limits output to 25,000 tokens by default", and tool search "is on by default". Matches sections 1.2 and 3.1.
- Precedent for an unauthenticated local server: Figma's desktop MCP server is turned on in the app and "runs locally at `http://127.0.0.1:3845/mcp`", and the client configuration holds only that URL ([Figma local server installation](https://developers.figma.com/docs/figma-mcp-server/local-server-installation/)). Not covered by the sections above; relevant to pairing in #412.
