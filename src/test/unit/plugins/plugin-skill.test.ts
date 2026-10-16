// @vitest-environment node
//
// Holds the Plugin authoring skill (skills/maibuk-plugin/SKILL.md) to the files,
// scripts, setup commands, and SDK entries it names, so a renamed path, a
// dropped script, or an unknown SDK subpath fails the gate instead of the
// author following it. It also pins the frontmatter name to the folder, and the
// setup script's SKILL_PATH constant to the folder the checkout ships.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { skillFrontmatter, skillReferenceProblems } from "../../support/plugin-skill";

const root = process.cwd();

/** The skill's folder name, which the frontmatter `name` must equal. */
const SKILL_FOLDER = "maibuk-plugin";

/** The checkout-relative folder the skill lives in, and `setup.mjs` links. */
const SKILL_PATH = `skills/${SKILL_FOLDER}`;

const markdown = readFileSync(join(root, SKILL_PATH, "SKILL.md"), "utf8");

describe("skillReferenceProblems()", () => {
  it("finds nothing wrong in the real skill", () => {
    expect(skillReferenceProblems(markdown, root)).toEqual([]);
  });

  it("reports a renamed pnpm script", () => {
    const broken = markdown.replace("pnpm check", "pnpm chek");
    expect(skillReferenceProblems(broken, root).some((problem) => problem.includes("chek"))).toBe(
      true
    );
  });

  it("reports a renamed doc path", () => {
    const broken = markdown.replace("docs/plugins/testing.md", "docs/plugins/tests.md");
    expect(skillReferenceProblems(broken, root).length).toBeGreaterThan(0);
  });

  it("reports a renamed doc the skill names without its folder", () => {
    const broken = markdown.split("`frame-ui.md`").join("`frames.md`");
    expect(skillReferenceProblems(broken, root)).toContainEqual(
      expect.stringContaining("frames.md")
    );
  });

  it("reports an unknown SDK subpath", () => {
    const broken = markdown.replace("@maibuk/plugin-sdk/ui-serve", "@maibuk/plugin-sdk/nope");
    expect(skillReferenceProblems(broken, root).some((problem) => problem.includes("nope"))).toBe(
      true
    );
  });
});

describe("the skill's frontmatter", () => {
  it("names its folder and carries a description", () => {
    const { name, description } = skillFrontmatter(markdown);
    expect(name).toBe(SKILL_FOLDER);
    expect(description).not.toBe("");
  });
});

describe("setup.mjs SKILL_PATH", () => {
  it("points at the skill folder the checkout ships", () => {
    const setup = readFileSync(join(root, "templates/plugin/scripts/setup.mjs"), "utf8");
    const match = /const SKILL_PATH = "([^"]+)"/.exec(setup);
    expect(match?.[1]).toBe(SKILL_PATH);
    expect(existsSync(join(root, SKILL_PATH, "SKILL.md"))).toBe(true);
  });
});
