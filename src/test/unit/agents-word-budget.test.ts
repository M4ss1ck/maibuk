import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  AGENTS_WORD_BUDGET,
  checkWordBudget,
  countWords,
} from "../../../scripts/agents-word-budget.mjs";

const root = resolve(__dirname, "../../..");
const script = join(root, "scripts/agents-word-budget.mjs");
const agents = readFileSync(join(root, "AGENTS.md"), "utf8");

/** The text of one `## ` section of AGENTS.md, without its heading. */
function section(title: string): string {
  const match = agents.match(new RegExp(`\\n## ${title}\\n([\\s\\S]*?)(?=\\n## |$)`));
  if (!match) throw new Error(`AGENTS.md has no "${title}" section`);
  return match[1];
}

function runBudget(file: string) {
  return spawnSync(process.execPath, [script, file], { encoding: "utf8" });
}

let scratch: string | null = null;
afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

describe("countWords()", () => {
  it("counts runs of non-whitespace, the way wc -w does", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  \n\t ")).toBe(0);
    expect(countWords("one")).toBe(1);
    expect(countWords("  one  two\n\tthree\r\n")).toBe(3);
    expect(countWords("| `a` | --- |")).toBe(5);
  });
});

describe("checkWordBudget()", () => {
  it("passes at the budget and fails one word past it", () => {
    expect(checkWordBudget("w ".repeat(AGENTS_WORD_BUDGET))).toEqual({
      words: AGENTS_WORD_BUDGET,
      budget: AGENTS_WORD_BUDGET,
      ok: true,
    });
    expect(checkWordBudget("w ".repeat(AGENTS_WORD_BUDGET + 1)).ok).toBe(false);
  });
});

describe("agents-word-budget CLI", () => {
  it("is green on AGENTS.md", () => {
    expect(AGENTS_WORD_BUDGET).toBe(2000);
    const result = runBudget(join(root, "AGENTS.md"));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`of ${AGENTS_WORD_BUDGET} words`);
  });

  it("is red on a copy of AGENTS.md padded past the budget", () => {
    scratch = mkdtempSync(join(tmpdir(), "agents-budget-"));
    const padded = join(scratch, "AGENTS.md");
    const missing = AGENTS_WORD_BUDGET - countWords(agents) + 1;
    writeFileSync(padded, `${agents}\n${"padding ".repeat(missing)}\n`);

    const result = runBudget(padded);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("over the 2000-word budget by 1");
  });
});

describe("AGENTS.md pointers", () => {
  const rows = section("Read before you work")
    .split("\n")
    .filter((line) => line.startsWith("| ") && !/^\| (When|-)/.test(line));

  it("say when to read each target, and every target exists", () => {
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) {
      const [when, read] = row.split("|").slice(1, 3).map((cell) => cell.trim());
      expect(when, row).toMatch(/^Before |^When |^Every /);
      const targets = [...read.matchAll(/`([^`]+\.md|docs\/adr\/)`/g)].map((m) => m[1]);
      expect(targets.length, row).toBeGreaterThan(0);
      for (const target of targets) expect(existsSync(join(root, target)), target).toBe(true);
    }
  });

  it("name only sections that exist in CODING_STANDARDS.md", () => {
    const standards = readFileSync(join(root, "CODING_STANDARDS.md"), "utf8");
    const headings = new Set(
      [...standards.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1].toLowerCase())
    );
    const named = [
      ...[...section("Read before you work").matchAll(/`CODING_STANDARDS\.md` "([^"]+)"/g)].map(
        (m) => m[1]
      ),
      ...[...section("Done means").matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]),
    ];
    expect(named.length).toBeGreaterThan(5);
    for (const name of named) {
      const found = [...headings].some((heading) => heading.startsWith(name.toLowerCase()));
      expect(found, `CODING_STANDARDS.md has no "${name}" heading`).toBe(true);
    }
  });

  // The old "Updating AGENTS.md" asked for every new utility here, which is
  // how the file reached 12,600 words.
  it("send new utilities and components to the utilities doc, which lists the shared hooks", () => {
    expect(section("Updating AGENTS.md")).toContain("`docs/agents/utilities-and-components.md`");
    const utilities = readFileSync(join(root, "docs/agents/utilities-and-components.md"), "utf8");
    expect(utilities).toContain("`useDebouncedCallback(callback, delay)`");
  });
});
