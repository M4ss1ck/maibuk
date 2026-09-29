// @vitest-environment node
// Periodic lane for the Dictation Command Interpreter (ADR 0015): p99 under
// 1 ms per line and under 10 ms to rebuild the phrase table, with every default
// plus 1,000 aliases and 1,000 Vocabulary entries. Run `pnpm bench:dictation`;
// scripts/dictation-bench-budget.mjs fails the run when a budget is missed.
// Never part of `pnpm test`: the gate lane has no timing assertions.
import { bench, describe } from "vitest";
import {
  INITIAL_INTERPRETER_STATE,
  buildPhraseTable,
  interpret,
} from "@/features/dictation/interpreter";
import { DICTATION_LANGUAGES } from "@/features/dictation/spoken-punctuation";
import { interpreterBenchCase } from "@/test/support/dictation-bench";

for (const language of DICTATION_LANGUAGES) {
  const benchCase = interpreterBenchCase(language);
  const table = buildPhraseTable(language, benchCase.options);

  describe(`dictation interpreter (${language})`, () => {
    bench("interpret: worst-case line", () => {
      interpret({
        line: benchCase.line,
        before: benchCase.before,
        capabilities: benchCase.capabilities,
        table,
        state: INITIAL_INTERPRETER_STATE,
      });
    });

    bench("rebuild: phrase table", () => {
      buildPhraseTable(language, benchCase.options);
    });
  });
}
