import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import es from "@/locales/es.json";
import {
  TUTORIAL_OUT_OF_SCOPE_TERMS,
  TUTORIAL_SECTIONS,
  nextPosition,
  previousPosition,
  sectionForPath,
  totalStepCount,
} from "@/features/tutorial/sections";
import { TUTORIAL_SECTION_IDS, type TutorialPosition } from "@/features/tutorial/types";

const ROOT = process.cwd();
const glossary = readFileSync(join(ROOT, "CONTEXT.md"), "utf8");

/** Every defined term above "Relationships": the main sections and "Decided, not built". */
function glossaryTerms(): string[] {
  const defined = glossary.split("## Relationships")[0];
  return [...defined.matchAll(/^\*\*(.+?)\*\*:\s*$/gm)].map((match) => match[1]);
}

function lookup(locale: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (node && typeof node === "object") return (node as Record<string, unknown>)[part];
    return undefined;
  }, locale);
}

function leafKeys(node: unknown, prefix = ""): string[] {
  if (!node || typeof node !== "object") return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leafKeys(value, prefix ? `${prefix}.${key}` : key)
  );
}

const allSteps = TUTORIAL_SECTIONS.flatMap((section) => section.steps);

describe("coverage gate: every glossary concept in scope has a Tutorial step", () => {
  const terms = glossaryTerms();
  const taught = new Set(allSteps.flatMap((step) => step.terms));

  it("finds the glossary", () => {
    expect(terms).toEqual(expect.arrayContaining(["Book", "Canvas", "Passphrase", "Tutorial"]));
  });

  it.each(terms)("%s is taught by a step or listed out of scope with a reason", (term) => {
    const outOfScope = TUTORIAL_OUT_OF_SCOPE_TERMS[term];
    expect(taught.has(term) || Boolean(outOfScope), term).toBe(true);
    expect(taught.has(term) && Boolean(outOfScope), `${term} is both taught and out of scope`).toBe(
      false
    );
  });

  it("names only real glossary terms", () => {
    const known = new Set(terms);
    expect([...taught].filter((term) => !known.has(term))).toEqual([]);
    expect(Object.keys(TUTORIAL_OUT_OF_SCOPE_TERMS).filter((term) => !known.has(term))).toEqual([]);
  });
});

describe("step definitions", () => {
  it("lists the eight sections in the order the Tutorial walks them", () => {
    expect(TUTORIAL_SECTIONS.map((section) => section.id)).toEqual([...TUTORIAL_SECTION_IDS]);
  });

  it("gives every step a unique id that names its section", () => {
    const ids = allSteps.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of TUTORIAL_SECTIONS) {
      for (const step of section.steps) expect(step.id.startsWith(`${section.id}.`)).toBe(true);
    }
  });

  it("ends the whole Tutorial on the Settings → Tutorial row", () => {
    const last = TUTORIAL_SECTIONS[TUTORIAL_SECTIONS.length - 1];
    expect(last.steps[last.steps.length - 1].id).toBe("settings.tutorial");
  });

  it("walks every step forward and back across section boundaries", () => {
    let position: TutorialPosition | null = { section: "books", step: 0 };
    const visited: string[] = [];
    while (position) {
      visited.push(`${position.section}:${position.step}`);
      position = nextPosition(position, null);
    }
    expect(visited).toHaveLength(totalStepCount());

    let back: TutorialPosition | null = {
      section: "settings",
      step: TUTORIAL_SECTIONS[7].steps.length - 1,
    };
    const reversed: string[] = [];
    while (back) {
      reversed.push(`${back.section}:${back.step}`);
      back = previousPosition(back, null);
    }
    expect(reversed.reverse()).toEqual(visited);
  });

  it("keeps a single-section run inside its section", () => {
    expect(nextPosition({ section: "canvas", step: 3 }, "canvas")).toBeNull();
    expect(previousPosition({ section: "canvas", step: 0 }, "canvas")).toBeNull();
  });

  it.each([
    ["/", "books"],
    ["/metrics", "books"],
    ["/book/abc", "book-editor"],
    ["/book/abc/cover", "cover-designer"],
    ["/notes", "notes"],
    ["/notes/n1", "notes"],
    ["/canvas", "canvas-gallery"],
    ["/canvas/c1", "canvas"],
    ["/ephemeral", "ephemeral"],
    ["/settings", "settings"],
  ])("runs the %s screen's section from the help dialog", (path, section) => {
    expect(sectionForPath(path)).toBe(section);
  });
});

describe("i18n: the Tutorial is complete in English and Spanish", () => {
  const stepKeys = allSteps.flatMap((step) => [
    step.titleKey,
    step.bodyKey,
    ...(step.link ? [step.link.labelKey] : []),
    ...(step.image ? [step.image.altKey] : []),
  ]);
  const sectionKeys = TUTORIAL_SECTIONS.map((section) => section.nameKey);

  it.each([
    ["en", en],
    ["es", es],
  ])("has every step and section string in %s", (_lang, locale) => {
    const missing = [...stepKeys, ...sectionKeys].filter((key) => {
      const value = lookup(locale, key);
      return typeof value !== "string" || value.trim() === "";
    });
    expect(missing).toEqual([]);
  });

  it("has the same Tutorial keys in both languages", () => {
    expect(leafKeys(es.tutorial).sort()).toEqual(leafKeys(en.tutorial).sort());
    expect(lookup(es, "shortcuts.startTutorial")).toBeTruthy();
    expect(lookup(es, "shortcuts.skipTutorial")).toBeTruthy();
    expect(lookup(es, "shortcuts.areaTutorial")).toBeTruthy();
  });

  it("has every sample string the Tutorial Library is built from", () => {
    const sources = ["src/features/tutorial/sample-library.ts", "src/features/tutorial/tutorial-library.ts"]
      .map((path) => readFileSync(join(ROOT, path), "utf8"))
      .join("\n");
    const used = new Set<string>();
    for (const match of sources.matchAll(/\btext\("([^"]+)"\)/g)) used.add(match[1]);
    for (const match of sources.matchAll(/\btag\("([^"]+)"\)/g)) used.add(`tags.${match[1]}`);
    expect(used.size).toBeGreaterThan(30);
    for (const locale of [en, es]) {
      const missing = [...used].filter(
        (key) => typeof lookup(locale, `tutorial.sample.${key}`) !== "string"
      );
      expect(missing).toEqual([]);
    }
  });

  it("uses no word the glossary says to avoid", () => {
    const english = leafKeys(en.tutorial)
      .map((key) => String(lookup(en.tutorial, key)))
      .join("\n");
    for (const avoided of [/\btour\b/i, /walkthrough/i, /onboarding/i, /\bguide\b/i, /sample book/i, /demo data/i, /sandbox/i]) {
      expect(english).not.toMatch(avoided);
    }
  });
});
