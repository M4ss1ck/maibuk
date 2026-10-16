// @vitest-environment node
//
// The Plugin authoring docs (docs/plugins/) are written in a later task. This
// gate fails until every required page exists, and then holds every page to the
// rules the code keeps: links resolve, commands name real scripts and files,
// and the prose avoids the words the glossary bans for a Plugin.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractCommands,
  extractLinks,
  headingsOf,
  isExternalLink,
  scanMarkdown,
  slugifyHeading,
  stripInlineCode,
} from "./plugin-docs-helpers";

const root = process.cwd();
const docsDir = join(root, "docs", "plugins");

/** The pages docs/plugins/README.md indexes. */
const REQUIRED_DOCS = [
  "README.md",
  "quickstart.md",
  "host-rendered-ui.md",
  "frame-ui.md",
  "testing.md",
  "development-mode.md",
  "packaging.md",
  "api-reference.md",
  "ui-reference.md",
] as const;

/** README files outside docs/plugins/ the same rules cover. */
const EXTRA_DOCS = ["templates/plugin/README.md", "plugins/README.md"];

/** Whole words the glossary avoids for a Plugin, case-insensitive. */
const AVOIDED_TERMS = /\b(extensions?|add-ons?|addon|mods?)\b/gi;

function docFilePaths(): string[] {
  const inDocs = existsSync(docsDir)
    ? readdirSync(docsDir)
        .filter((name) => name.endsWith(".md"))
        .sort()
        .map((name) => join(docsDir, name))
    : [];
  return [...inDocs, ...EXTRA_DOCS.map((doc) => join(root, doc))];
}

function scriptNames(): Set<string> {
  const names = new Set<string>();
  for (const manifest of [
    join(root, "package.json"),
    join(root, "templates/plugin/package.json"),
  ]) {
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as {
      scripts?: Record<string, string>;
    };
    for (const name of Object.keys(parsed.scripts ?? {})) names.add(name);
  }
  return names;
}

/** A command path resolves at the repo root or inside templates/plugin/. */
function commandPathExists(commandPath: string): boolean {
  return (
    existsSync(join(root, commandPath)) || existsSync(join(root, "templates/plugin", commandPath))
  );
}

const SHELL_FIXTURE = [
  "Prose mentioning pnpm not-a-script.",
  "",
  "```bash",
  "$ pnpm build:plugins",
  "pnpm plugin:check <path>   # every step",
  "pnpm install",
  "pnpm run test:run",
  "node scripts/setup.mjs --maibuk /path/to/maibuk",
  "tsx scripts/plugin/cli.ts build",
  "```",
  "",
  "```ts",
  "// pnpm not-a-script",
  "```",
].join("\n");

const LINK_FIXTURE = [
  "See [Quickstart](quickstart.md) and [Frame UI](frame-ui.md#the-frame-api).",
  "Skip [the web](https://example.com), [mail](mailto:a@b.c) and [here](#anchor).",
  "An ![image](shot.png) is not a link.",
  "",
  "```",
  "[in code](nope.md)",
  "```",
].join("\n");

describe("slugifyHeading()", () => {
  it("matches GitHub's heading anchors", () => {
    expect(slugifyHeading("Running in development mode")).toBe("running-in-development-mode");
    expect(slugifyHeading("`library.books.list`")).toBe("librarybookslist");
    expect(slugifyHeading("Host-rendered UI")).toBe("host-rendered-ui");
    expect(slugifyHeading("What's new?")).toBe("whats-new");
    expect(slugifyHeading("The Frame API")).toBe("the-frame-api");
  });
});

describe("extractLinks()", () => {
  it("keeps relative targets with their anchors and line, and drops images and code", () => {
    expect(extractLinks(LINK_FIXTURE)).toEqual([
      {
        line: 1,
        label: "Quickstart",
        target: "quickstart.md",
        path: "quickstart.md",
        anchor: null,
      },
      {
        line: 1,
        label: "Frame UI",
        target: "frame-ui.md#the-frame-api",
        path: "frame-ui.md",
        anchor: "the-frame-api",
      },
      {
        line: 2,
        label: "the web",
        target: "https://example.com",
        path: "https://example.com",
        anchor: null,
      },
      { line: 2, label: "mail", target: "mailto:a@b.c", path: "mailto:a@b.c", anchor: null },
      { line: 2, label: "here", target: "#anchor", path: "", anchor: "anchor" },
    ]);
  });

  it("leaves only the relative links to resolve", () => {
    const relative = extractLinks(LINK_FIXTURE)
      .filter((link) => !isExternalLink(link))
      .map((link) => link.target);
    expect(relative).toEqual(["quickstart.md", "frame-ui.md#the-frame-api"]);
  });
});

describe("extractCommands()", () => {
  it("reads shell commands, skipping builtins, comments, and non-shell fences", () => {
    expect(extractCommands(SHELL_FIXTURE)).toEqual([
      { line: 4, kind: "pnpm", name: "build:plugins", command: "pnpm build:plugins" },
      {
        line: 5,
        kind: "pnpm",
        name: "plugin:check",
        command: "pnpm plugin:check <path>",
      },
      { line: 7, kind: "pnpm", name: "test:run", command: "pnpm run test:run" },
      {
        line: 8,
        kind: "node",
        path: "scripts/setup.mjs",
        command: "node scripts/setup.mjs --maibuk /path/to/maibuk",
      },
      {
        line: 9,
        kind: "tsx",
        path: "scripts/plugin/cli.ts",
        command: "tsx scripts/plugin/cli.ts build",
      },
    ]);
  });
});

describe("Plugin authoring docs", () => {
  it("ships every required page", () => {
    const missing = REQUIRED_DOCS.map((name) => join("docs", "plugins", name)).filter(
      (doc) => !existsSync(join(root, doc))
    );
    expect(missing).toEqual([]);
  });

  it("links every required page from the index", () => {
    const indexPath = join(docsDir, "README.md");
    expect(existsSync(indexPath), "docs/plugins/README.md is missing").toBe(true);

    const linked = new Set(
      extractLinks(readFileSync(indexPath, "utf8")).map((link) =>
        resolve(dirname(indexPath), link.path)
      )
    );
    const unlinked = REQUIRED_DOCS.filter(
      (name) => name !== "README.md" && !linked.has(join(docsDir, name))
    );
    expect(unlinked.map((name) => `docs/plugins/README.md does not link ${name}`)).toEqual([]);
  });

  it("resolves every relative link, anchor included", () => {
    const failures: string[] = [];

    for (const file of docFilePaths()) {
      for (const link of extractLinks(readFileSync(file, "utf8"))) {
        if (isExternalLink(link)) continue;
        const where = `${relative(root, file)}:${link.line}`;
        const target = resolve(dirname(file), link.path);
        if (!existsSync(target)) {
          failures.push(`${where} does not resolve ${link.target}`);
          continue;
        }
        if (link.anchor && link.path.endsWith(".md")) {
          const anchors = headingsOf(readFileSync(target, "utf8"));
          if (!anchors.includes(link.anchor)) {
            failures.push(
              `${where} ${link.target} has no heading that slugifies to #${link.anchor}`
            );
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("runs only real scripts and existing files", () => {
    const scripts = scriptNames();
    const failures: string[] = [];

    for (const file of docFilePaths()) {
      for (const command of extractCommands(readFileSync(file, "utf8"))) {
        const where = `${relative(root, file)}:${command.line}`;
        if (command.kind === "pnpm") {
          if (!scripts.has(command.name)) {
            failures.push(
              `${where} pnpm ${command.name} is not a script in package.json or templates/plugin/package.json`
            );
          }
        } else if (!commandPathExists(command.path)) {
          failures.push(
            `${where} ${command.kind} ${command.path} exists neither at the repo root nor under templates/plugin/`
          );
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("describes a Plugin without an avoided glossary word", () => {
    const failures: string[] = [];

    for (const file of docFilePaths()) {
      for (const { line, text, fence } of scanMarkdown(readFileSync(file, "utf8"))) {
        if (fence !== null) continue;
        for (const [word] of stripInlineCode(text).matchAll(AVOIDED_TERMS)) {
          failures.push(`${relative(root, file)}:${line} says "${word}"`);
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
