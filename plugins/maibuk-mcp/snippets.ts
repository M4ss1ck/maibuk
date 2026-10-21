/**
 * The setup snippets the MCP Server page shows (#594): the exact text an Agent
 * needs to reach this Plugin, one per Agent, with the Plugin Endpoint's MCP
 * address and the stored Key filled in. Pure string builders, so the page's
 * Copy buttons and the copy Commands put the same text on the clipboard.
 *
 * The vendor text was checked against each vendor's docs on 2026-10-21. The
 * server name is always `maibuk`; the Key travels as a Bearer header.
 */

/** The Agent each snippet belongs to. */
export type SnippetKind = "claudeCode" | "codex" | "openCode" | "cursor";

/** Every shipped snippet, in the order the page shows them. */
export const SNIPPET_KINDS: readonly SnippetKind[] = ["claudeCode", "codex", "openCode", "cursor"];

/** The two values every snippet fills in. */
export interface SnippetValues {
  /** This Plugin's MCP address, the Plugin Endpoint's base plus the MCP path. */
  url: string;
  /** The stored Key, sent as a Bearer token. */
  key: string;
}

/**
 * The MCP address for one Plugin Endpoint base. The base the host returns ends
 * with `/plugin/<pluginId>/` (docs/plugins/endpoint.md), so the MCP path is
 * joined onto it without a second slash.
 */
export function mcpUrl(address: string): string {
  return `${address.replace(/\/+$/, "")}/mcp`;
}

/** Claude Code's one-line `claude mcp add`. */
export function claudeCodeSnippet({ url, key }: SnippetValues): string {
  return `claude mcp add --transport http maibuk ${url} --header "Authorization: Bearer ${key}"`;
}

/** Codex's `~/.codex/config.toml` table. */
export function codexSnippet({ url, key }: SnippetValues): string {
  return [
    "[mcp_servers.maibuk]",
    `url = "${url}"`,
    `http_headers = { Authorization = "Bearer ${key}" }`,
  ].join("\n");
}

/** OpenCode's `opencode.json` document, schema first. */
export function openCodeSnippet({ url, key }: SnippetValues): string {
  return JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      mcp: {
        maibuk: {
          type: "remote",
          url,
          enabled: true,
          oauth: false,
          headers: { Authorization: `Bearer ${key}` },
        },
      },
    },
    null,
    2
  );
}

/** Cursor's `~/.cursor/mcp.json` document. */
export function cursorSnippet({ url, key }: SnippetValues): string {
  return JSON.stringify(
    {
      mcpServers: {
        maibuk: { url, headers: { Authorization: `Bearer ${key}` } },
      },
    },
    null,
    2
  );
}

/** The snippet for one Agent, by its kind. */
export function snippet(kind: SnippetKind, values: SnippetValues): string {
  switch (kind) {
    case "claudeCode":
      return claudeCodeSnippet(values);
    case "codex":
      return codexSnippet(values);
    case "openCode":
      return openCodeSnippet(values);
    case "cursor":
      return cursorSnippet(values);
  }
}
