import { describe, expect, it } from "vitest";
import {
  claudeCodeSnippet,
  codexSnippet,
  cursorSnippet,
  mcpUrl,
  openCodeSnippet,
  snippet,
  SNIPPET_KINDS,
} from "./snippets";

/**
 * The setup snippets (#594): the exact text each Agent needs, with the Plugin
 * Endpoint's MCP address and the stored Key filled in. The vendors' own docs
 * were checked on 2026-10-21; these literals are the contract, so a change to
 * one shape fails here before it reaches a page.
 */

const BASE = "http://127.0.0.1:51789/plugin/maibuk-mcp/";
const URL = "http://127.0.0.1:51789/plugin/maibuk-mcp/mcp";
const KEY = "0123456789abcdef0123456789abcdef";

describe("MCP setup snippets", () => {
  it("joins the MCP path onto the Plugin Endpoint address", () => {
    expect(mcpUrl(BASE)).toBe(URL);
    expect(mcpUrl("http://127.0.0.1:51789/plugin/maibuk-mcp")).toBe(URL);
  });

  it("gives Claude Code the one-line add command", () => {
    expect(claudeCodeSnippet({ url: URL, key: KEY })).toBe(
      'claude mcp add --transport http maibuk http://127.0.0.1:51789/plugin/maibuk-mcp/mcp --header "Authorization: Bearer 0123456789abcdef0123456789abcdef"'
    );
  });

  it("gives Codex the config.toml table", () => {
    expect(codexSnippet({ url: URL, key: KEY })).toBe(`[mcp_servers.maibuk]
url = "http://127.0.0.1:51789/plugin/maibuk-mcp/mcp"
http_headers = { Authorization = "Bearer 0123456789abcdef0123456789abcdef" }`);
  });

  it("gives OpenCode the opencode.json document, schema first", () => {
    expect(openCodeSnippet({ url: URL, key: KEY })).toBe(`{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "maibuk": {
      "type": "remote",
      "url": "http://127.0.0.1:51789/plugin/maibuk-mcp/mcp",
      "enabled": true,
      "oauth": false,
      "headers": {
        "Authorization": "Bearer 0123456789abcdef0123456789abcdef"
      }
    }
  }
}`);
  });

  it("gives Cursor the mcp.json document", () => {
    expect(cursorSnippet({ url: URL, key: KEY })).toBe(`{
  "mcpServers": {
    "maibuk": {
      "url": "http://127.0.0.1:51789/plugin/maibuk-mcp/mcp",
      "headers": {
        "Authorization": "Bearer 0123456789abcdef0123456789abcdef"
      }
    }
  }
}`);
  });

  it("builds every shipped kind by name", () => {
    expect(SNIPPET_KINDS).toEqual(["claudeCode", "codex", "openCode", "cursor"]);
    for (const kind of SNIPPET_KINDS) {
      expect(snippet(kind, { url: URL, key: KEY })).toBe(
        {
          claudeCode: claudeCodeSnippet,
          codex: codexSnippet,
          openCode: openCodeSnippet,
          cursor: cursorSnippet,
        }[kind]({ url: URL, key: KEY })
      );
    }
  });
});
