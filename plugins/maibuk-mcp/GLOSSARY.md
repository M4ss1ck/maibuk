# MCP Server

MCP Server is a Built-in Plugin that lets AI tools running outside Maibuk read and change the author's Library through the Model Context Protocol. These terms bind only inside `plugins/maibuk-mcp/`; Maibuk's own terms come from the root `GLOSSARY.md`.

**Activity**:
One MCP tool call as the activity log records it: when it happened, the Agent, the tool, the item it named, and whether it worked, with none of the author's text.
_Avoid_: event, trace, history entry

**Agent**:
An AI tool the author runs outside Maibuk and connects to it, such as Claude Code, Codex, OpenCode, Cursor, or Claude Desktop. It names itself; Maibuk never verifies that name.
_Avoid_: client, assistant, bot

**Connection**:
One Agent's use of this Plugin's Plugin Endpoint, from its first request to when it stops sending them.
_Avoid_: session, pairing

**Key**:
The secret this Plugin makes when it is turned on and puts in the setup snippet; an Agent sends it with every request, and a request without it is refused.
_Avoid_: token, password
