// Pure Markdown readers for src/test/unit/plugins/plugin-docs.test.ts.
//
// The files under docs/plugins/ are written in a later task, so these helpers
// are proven against inline fixtures in the gate's own suite, independently of
// the real docs.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const FENCE = /^\s*(`{3,}|~{3,})\s*(\S*)/;
const LINK = /(!?)\[([^\]]*)\]\(([^)]+)\)/g;
const HEADING = /^#{1,6}\s+(.*)$/;

const SHELL_FENCES = new Set(["bash", "sh", "shell"]);
const PNPM_BUILTINS = new Set(["install", "add", "i", "dlx", "exec", "run"]);

export interface MarkdownLine {
  /** 1-based line number in the source file. */
  line: number;
  /** The raw line, indentation included. */
  text: string;
  /** The info string of the fenced block this line sits inside, else null. */
  fence: string | null;
}

/**
 * Splits Markdown into lines and tags each one with the fenced block it sits
 * inside (the fence language, lowercased). Fence marker lines themselves are
 * reported with `fence: null`: they are neither prose nor content.
 */
export function scanMarkdown(content: string): MarkdownLine[] {
  const scanned: MarkdownLine[] = [];
  let marker: string | null = null;
  let language = "";

  content.split(/\r?\n/).forEach((text, index) => {
    const fence = FENCE.exec(text);
    if (fence) {
      if (marker === null) {
        marker = fence[1][0];
        language = fence[2].toLowerCase();
      } else if (fence[1][0] === marker) {
        marker = null;
        language = "";
      }
      scanned.push({ line: index + 1, text, fence: null });
      return;
    }
    scanned.push({ line: index + 1, text, fence: marker === null ? null : language });
  });

  return scanned;
}

/** Removes `inline code`, whose contents are not prose. */
export function stripInlineCode(text: string): string {
  return text.replace(/`[^`]*`/g, "");
}

export interface MarkdownLink {
  line: number;
  label: string;
  /** The raw target between the parentheses, title stripped. */
  target: string;
  /** The target without its `#anchor`. */
  path: string;
  anchor: string | null;
}

/** Every non-image link in the prose: links inside fences and code are ignored. */
export function extractLinks(content: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];

  for (const { line, text, fence } of scanMarkdown(content)) {
    if (fence !== null) continue;
    for (const match of stripInlineCode(text).matchAll(LINK)) {
      const [image, label, raw] = match.slice(1);
      if (image === "!") continue;
      const target = raw.trim().replace(/\s+["'(].*$/, "");
      const hash = target.indexOf("#");
      links.push({
        line,
        label,
        target,
        path: hash === -1 ? target : target.slice(0, hash),
        anchor: hash === -1 ? null : target.slice(hash + 1),
      });
    }
  }

  return links;
}

/** Links the gate leaves alone: a scheme, a protocol-relative URL, or a pure `#anchor`. */
export function isExternalLink(link: MarkdownLink): boolean {
  if (link.path === "") return true;
  return /^(https?|mailto):/i.test(link.path) || link.path.startsWith("//");
}

/** GitHub's heading anchor: lowercase, punctuation gone, spaces to hyphens. */
export function slugifyHeading(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\- ]/g, "")
    .replace(/ /g, "-");
}

/** The slugified `#anchor` of every heading in the prose. */
export function headingsOf(content: string): string[] {
  const headings: string[] = [];

  for (const { text, fence } of scanMarkdown(content)) {
    if (fence !== null) continue;
    const match = HEADING.exec(text.trim());
    if (match) headings.push(slugifyHeading(match[1].replace(/\s+#+\s*$/, "")));
  }

  return headings;
}

export type DocCommand =
  | { line: number; kind: "pnpm"; name: string; command: string }
  | { line: number; kind: "node" | "tsx"; path: string; command: string };

type ParsedCommand =
  | { kind: "pnpm"; name: string; command: string }
  | { kind: "node" | "tsx"; path: string; command: string };

/** Every `pnpm`/`node`/`tsx` command in a fenced block tagged bash, sh, or shell. */
export function extractCommands(content: string): DocCommand[] {
  const commands: DocCommand[] = [];

  for (const { line, text, fence } of scanMarkdown(content)) {
    if (fence === null || !SHELL_FENCES.has(fence)) continue;
    const command = parseCommand(text);
    if (command) commands.push({ line, ...command });
  }

  return commands;
}

function parseCommand(raw: string): ParsedCommand | null {
  let command = raw.trim();
  if (command.startsWith("$ ")) command = command.slice(2).trim();
  const comment = command.indexOf(" #");
  if (comment !== -1) command = command.slice(0, comment).trim();
  if (command === "" || command.startsWith("#")) return null;

  const [program, ...rest] = command.split(/\s+/);
  if (program === "pnpm") {
    const subcommand = rest[0];
    if (!subcommand) return null;
    if (subcommand !== "run" && PNPM_BUILTINS.has(subcommand)) return null;
    const name = subcommand === "run" ? rest[1] : subcommand;
    if (!name) return null;
    return { kind: "pnpm", name, command };
  }
  if (program === "node" || program === "tsx") {
    const path = rest[0];
    if (!path) return null;
    return { kind: program, path, command };
  }

  return null;
}

/** Every script name the root and the Plugin template's package.json declare. */
export function scriptNames(repoRoot: string): Set<string> {
  const names = new Set<string>();
  for (const manifest of [
    join(repoRoot, "package.json"),
    join(repoRoot, "templates/plugin/package.json"),
  ]) {
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as {
      scripts?: Record<string, string>;
    };
    for (const name of Object.keys(parsed.scripts ?? {})) names.add(name);
  }
  return names;
}
