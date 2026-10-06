#!/usr/bin/env node
// Fails when AGENTS.md outgrows its word budget (issue #421). Every agent
// session loads the whole file, so reference material belongs behind a pointer
// in it, not in it.
//
//   node scripts/agents-word-budget.mjs [file]
//
// Words are counted the way `wc -w` counts them: runs of non-whitespace.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const AGENTS_WORD_BUDGET = 2000;

export function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

export function checkWordBudget(text, budget = AGENTS_WORD_BUDGET) {
  const words = countWords(text);
  return { words, budget, ok: words <= budget };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2] ?? "AGENTS.md";
  const { words, budget, ok } = checkWordBudget(readFileSync(path, "utf8"));
  if (ok) {
    console.log(`${path}: ${words} of ${budget} words`);
  } else {
    console.error(
      `${path}: ${words} words, over the ${budget}-word budget by ${words - budget}. ` +
        "Move reference material to CODING_STANDARDS.md or docs/agents/ and leave a pointer (see its \"Updating AGENTS.md\")."
    );
    process.exit(1);
  }
}
