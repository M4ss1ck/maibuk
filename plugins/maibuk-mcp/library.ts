/**
 * Shared helpers for the maibuk-mcp Plugin's tools: the Tutorial refusal,
 * short ids, paging, ref resolution, excerpts, and content windows. Every
 * tool builds on these, so their sentences stay identical everywhere.
 */

import type { CallToolResult } from "@modelcontextprotocol/server";

/** Whether a Plugin API failure refuses with `library-unavailable`. */
export function isLibraryUnavailable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "library-unavailable"
  );
}

export const LIBRARY_UNAVAILABLE_TEXT =
  "The Library is unavailable while the Tutorial runs; try again when it ends.";

function libraryUnavailableResult(): CallToolResult {
  return { content: [{ type: "text", text: LIBRARY_UNAVAILABLE_TEXT }], isError: true };
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** The `YYYY-MM-DD` date for milliseconds since the epoch. */
export function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Runs `fn`, turning a thrown `library-unavailable` error into the Tutorial
 * refusal; any other error propagates to the caller.
 */
export async function libraryCall(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (error) {
    if (isLibraryUnavailable(error)) return libraryUnavailableResult();
    throw error;
  }
}

/**
 * Short id for `id` among its siblings: the shortest prefix of at least 8
 * characters that no other sibling id starts with. An id shorter than 8
 * characters is returned whole.
 */
export function shortId(id: string, siblings: readonly string[]): string {
  if (id.length < 8) return id;
  for (let length = 8; length <= id.length; length += 1) {
    const prefix = id.slice(0, length);
    const clash = siblings.some((other) => other !== id && other.startsWith(prefix));
    if (!clash) return prefix;
  }
  return id;
}

function titleOrUntitled(title: string): string {
  return title === "" ? "Untitled" : title;
}

/**
 * One excerpt line's text: whitespace runs collapsed to one space and
 * trimmed, cut to 150 UTF-16 units with `…` when longer (149 when unit 150
 * would split a surrogate pair). Empty when there is no text.
 */
export function excerptOf(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 150) return collapsed;
  let end = 150;
  const code = collapsed.charCodeAt(149);
  if (code >= 0xd800 && code <= 0xdbff) end = 149;
  return `${collapsed.slice(0, end)}…`;
}

/**
 * One page of a `<noun> <from>-<to> of <total>` list: the same paging the
 * Book tools always had (limit default 20, clamped to 1..50; base64 offset
 * cursor), generalised over any rows. Only page rows reach `lines`.
 */
export async function pageLines<T>(options: {
  rows: T[];
  cursor?: string;
  limit?: number;
  noun: string;
  tool: string;
  lines: (row: T) => Promise<string[]> | string[];
}): Promise<CallToolResult> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);

  const invalidCursor = errorResult(
    `The cursor is not valid; call ${options.tool} without a cursor to start again.`
  );

  let offset = 0;
  if (options.cursor !== undefined) {
    let decoded: string;
    try {
      decoded = atob(options.cursor);
    } catch {
      return invalidCursor;
    }
    if (!/^\d+$/.test(decoded)) {
      return invalidCursor;
    }
    const n = Number(decoded);
    if (!Number.isInteger(n) || n < 0) {
      return invalidCursor;
    }
    const total = options.rows.length;
    if (total === 0) {
      if (n !== 0) {
        return invalidCursor;
      }
    } else if (n >= total) {
      return invalidCursor;
    }
    offset = n;
  }

  const total = options.rows.length;
  if (total === 0) {
    return { content: [{ type: "text", text: `No ${options.noun} match.` }] };
  }

  const page = options.rows.slice(offset, offset + limit);
  const from = offset + 1;
  const to = offset + page.length;
  const lines: string[] = [`${options.noun} ${from}-${to} of ${total}`];
  for (const row of page) {
    const produced = await options.lines(row);
    for (const line of produced) lines.push(line);
  }
  const moreRemain = offset + limit < total;
  if (moreRemain) {
    lines.push(`More: call ${options.tool} with cursor "${btoa(String(offset + limit))}"`);
  }
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

/**
 * Resolves one id or 8+ character prefix among `rows`: the same resolution
 * `get_book` always had. An exact id wins; one prefix match resolves; several
 * answer with their candidate lines.
 */
export function resolveRef<T extends { id: string }>(options: {
  ref: string;
  rows: T[];
  noun: string;
  listTool: string;
  tool: string;
  line: (row: T) => string;
}): { row: T } | { result: CallToolResult } {
  const ref = options.ref.trim();

  if (ref.length < 8) {
    return {
      result: errorResult(
        `Use at least 8 characters of a ${options.noun} id; call ${options.listTool} to see them.`
      ),
    };
  }

  const exact = options.rows.find((row) => row.id === ref);
  if (exact) return { row: exact };

  const matches = options.rows.filter((row) => row.id.startsWith(ref));
  if (matches.length === 0) {
    return {
      result: errorResult(
        `No ${options.noun} has the id ${ref}; call ${options.listTool} to see the ${options.noun}s.`
      ),
    };
  }
  if (matches.length === 1) return { row: matches[0] };

  const lines: string[] = [
    `The id ${ref} matches several ${options.noun}s; call ${options.tool} again with one of these ids:`,
  ];
  for (const match of matches) lines.push(options.line(match));
  return { result: errorResult(lines.join("\n")) };
}

/**
 * One window over `content`: length default 20000, clamped to 1..50000. An
 * offset past the end reports `pastEnd` (offset == total is an empty window);
 * the end never splits a surrogate pair. `nextOffset` tells where to continue.
 */
export function readWindow(
  content: string,
  offset?: number,
  length?: number
):
  | { window: string; start: number; end: number; total: number; nextOffset: number | null }
  | { pastEnd: true; total: number } {
  const total = content.length;
  const start = offset ?? 0;
  if (start > total) return { pastEnd: true, total };
  const clamped = Math.min(Math.max(length ?? 20000, 1), 50000);
  let end = Math.min(start + clamped, total);
  if (end < total && end - 1 > start) {
    const code = content.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  }
  return {
    window: content.slice(start, end),
    start,
    end,
    total,
    nextOffset: end < total ? end : null,
  };
}

export { errorResult, libraryUnavailableResult, titleOrUntitled };
