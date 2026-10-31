// Pure readers for src/test/unit/plugins/plugin-skill.test.ts.
//
// The Plugin authoring skill (skills/maibuk-plugin/SKILL.md) names repo files,
// `pnpm` scripts, a `node scripts/...` setup command, and SDK specifiers. These
// helpers resolve every one of them against the checkout, so a stale path, a
// renamed script, or an unknown SDK subpath fails the gate instead of the author
// who follows it. The SDK's public surface is read from `scripts/plugin/config`
// (the same source the build and typecheck use), never duplicated here.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { externalAliases, SDK_PACKAGE, TEST_KIT_PACKAGE } from "../../../scripts/plugin/config";
import { scriptNames } from "./plugin-docs";

/** The repo-relative prefixes an inline-code reference can name. */
const REPO_PREFIXES = ["docs/", "src/", "plugins/", "templates/", "scripts/", "skills/"];

/** A doc named without its folder, such as `testing.md`; it lives in docs/plugins/. */
const BARE_DOC = /^[A-Za-z0-9_-]+\.md$/;

/** Inline-code spans: the backticked tokens in the prose. */
const INLINE_CODE = /`([^`\n]+)`/g;

/** A `pnpm <name>` command anywhere in the text. */
const PNPM_COMMAND = /\bpnpm\s+([A-Za-z0-9:_-]+)/g;

/** A `node scripts/<file>` command; the file resolves under templates/plugin/. */
const NODE_SCRIPT = /\bnode\s+(scripts\/[^\s`"']+)/g;

/** A `@maibuk/...` specifier anywhere in the text. */
const MAIBUK_SPECIFIER = /@maibuk\/[A-Za-z0-9._/-]+/g;

/** The `name` and `description` a skill's YAML frontmatter carries. */
export interface SkillFrontmatter {
  name: string;
  description: string;
}

/**
 * Reads a skill's frontmatter `name` and `description`, each trimmed. Returns
 * empty strings when the frontmatter or a field is absent.
 */
export function skillFrontmatter(markdown: string): SkillFrontmatter {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  const body = block?.[1] ?? "";
  const name = /^name:\s*(.*)$/m.exec(body)?.[1]?.trim() ?? "";
  const description = /^description:\s*(.*)$/m.exec(body)?.[1]?.trim() ?? "";
  return { name, description };
}

/**
 * The SDK's public subpath names, read from the aliases `scripts/plugin/config`
 * builds: a `@maibuk/plugin-sdk/<name>` alias contributes `<name>`.
 */
function sdkSubpathNames(repoRoot: string): Set<string> {
  const names = new Set<string>();
  for (const alias of externalAliases(repoRoot)) {
    const find = alias.find;
    if (typeof find !== "string") continue;
    if (find.startsWith(`${SDK_PACKAGE}/`)) names.add(find.slice(SDK_PACKAGE.length + 1));
  }
  return names;
}

/**
 * Every broken reference in a Plugin authoring skill, one human-readable
 * problem each: an inline-code repo path that does not exist, a bare doc name
 * that is not a page in docs/plugins/, a `pnpm` script
 * that is not declared, a `node scripts/<file>` under templates/plugin/ that is
 * missing, or an `@maibuk/...` specifier that is neither the SDK, the test kit,
 * nor one of the SDK's public subpaths.
 */
export function skillReferenceProblems(markdown: string, repoRoot: string): string[] {
  const problems: string[] = [];
  const scripts = scriptNames(repoRoot);
  const sdkSubpaths = sdkSubpathNames(repoRoot);

  for (const [, token] of markdown.matchAll(INLINE_CODE)) {
    if (token.includes("<")) continue;
    if (BARE_DOC.test(token)) {
      if (!existsSync(join(repoRoot, "docs", "plugins", token))) {
        problems.push(`inline code \`${token}\` is not a page in docs/plugins/`);
      }
      continue;
    }
    if (!REPO_PREFIXES.some((prefix) => token.startsWith(prefix))) continue;
    const path = token.replace(/\/$/, "");
    if (!existsSync(join(repoRoot, path))) {
      problems.push(`inline code \`${token}\` does not exist under the checkout`);
    }
  }

  for (const [, name] of markdown.matchAll(PNPM_COMMAND)) {
    if (!scripts.has(name)) {
      problems.push(
        `pnpm ${name} is not a script in package.json or templates/plugin/package.json`
      );
    }
  }

  for (const [, file] of markdown.matchAll(NODE_SCRIPT)) {
    if (!existsSync(join(repoRoot, "templates", "plugin", file))) {
      problems.push(`${file} does not exist under templates/plugin/`);
    }
  }

  for (const [specifier] of markdown.matchAll(MAIBUK_SPECIFIER)) {
    if (specifier === SDK_PACKAGE || specifier === TEST_KIT_PACKAGE) continue;
    if (specifier.startsWith(`${SDK_PACKAGE}/`)) {
      const subpath = specifier.slice(SDK_PACKAGE.length + 1);
      if (!sdkSubpaths.has(subpath)) {
        problems.push(`${specifier} is not a public ${SDK_PACKAGE} subpath`);
      }
      continue;
    }
    problems.push(`${specifier} is not the Plugin SDK or test kit`);
  }

  return problems;
}
