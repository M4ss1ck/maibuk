// The Plugin CSS scoper's Chromium ground truth (issue #484). jsdom's CSS
// parser is not the browser's, so the unit tests can only prove layer 1 (the
// tokenizer pre-check); this helper runs the same `scopePluginCss` over a
// hostile corpus and re-parses every output with the real engine
// (`CSSStyleSheet.replaceSync`), asserting no style rule escapes the scope.
// Setup-only, like the sandbox helpers: page script, never an assertion
// surface, and it lives in support so the keyboard-contract guard stays happy.

import type { Page } from "@playwright/test";
import { scopePluginCss } from "@/features/plugins/remote-ui/css-scope";

/** The scope attribute the corpus scopes to. */
export const CORPUS_SCOPE = '[data-plugin-ui="corpus"]';

export interface CssScopeCorpusResult {
  /** How many corpus entries were scoped. */
  total: number;
  /** One entry per style rule part whose selector did not start with the scope. */
  leaks: string[];
  /** The scoped output per entry, for a failure message. */
  outputs: { name: string; scoped: boolean }[];
}

interface CorpusEntry {
  name: string;
  css: string;
}

/** Every hostile input the scoper must fail closed on or scope. */
export const CSS_SCOPE_CORPUS: readonly CorpusEntry[] = [
  { name: "url() break-out", css: ".a{b:url(} ) } body{display:none}" },
  { name: "double-quoted bad string", css: '.a{b:"x\n} body{display:none} .z{c:"}' },
  { name: "single-quoted bad string", css: ".a{b:'x\n} body{display:none} .z{c:'}" },
  { name: "leading ~", css: "~ .x{color:red}" },
  { name: "leading +", css: "+ .x{color:red}" },
  { name: "leading >", css: "> .x{color:red}" },
  { name: "leading ~ behind a comment", css: "/* lead */ ~ .x{color:red}" },
  { name: "leading + behind a comment", css: "/* lead */ + .x{color:red}" },
  { name: "leading > behind a comment", css: "/* lead */ > .x{color:red}" },
  { name: "@scope", css: "@scope (body){p{color:red}}" },
  {
    name: "@import between rules",
    css: '.a{color:red} @import url("https://x/y.css"); .b{color:blue}',
  },
  { name: "unclosed block", css: ".a{b:c" },
  { name: "block value", css: ".a{b:{}} body{}" },
  { name: "comment brace", css: ".a{b:c/*}*/} body{}" },
  { name: "escaped newline value", css: ".a{b:\\\n} body{}" },
];

interface CorpusOutput {
  name: string;
  out: string;
}

/**
 * Scopes the corpus and verifies every output against Chromium. Returns the
 * leak list (empty when every style rule is scoped) and whether each entry was
 * dropped or scoped.
 */
export function checkCssScopeCorpus(page: Page): Promise<CssScopeCorpusResult> {
  const outputs: CorpusOutput[] = CSS_SCOPE_CORPUS.map((entry) => ({
    name: entry.name,
    out: scopePluginCss(entry.css, CORPUS_SCOPE),
  }));

  return page.evaluate<CssScopeCorpusResult, { outputs: CorpusOutput[]; scope: string }>(
    ({ outputs, scope }) => {
      const leaks: string[] = [];
      const walk = (rules: CSSRuleList, name: string): void => {
        for (const rule of Array.from(rules)) {
          const style = rule as CSSStyleRule;
          if (typeof style.selectorText === "string") {
            for (const part of style.selectorText.split(",")) {
              if (!part.trim().startsWith(scope)) {
                leaks.push(`${name}: ${style.selectorText}`);
              }
            }
          }
          const grouping = rule as CSSGroupingRule;
          if (grouping.cssRules !== undefined) walk(grouping.cssRules, name);
        }
      };
      for (const { name, out } of outputs) {
        if (out.trim() === "") continue;
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(out);
        walk(sheet.cssRules, name);
      }
      return {
        total: outputs.length,
        leaks,
        outputs: outputs.map(({ name, out }) => ({ name, scoped: out.trim() !== "" })),
      };
    },
    { outputs, scope: CORPUS_SCOPE }
  );
}
