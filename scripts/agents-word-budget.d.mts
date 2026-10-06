// Types for the plain-JavaScript budget check, so `tsc` can type-check its test
// without enabling `allowJs` project-wide.
export const AGENTS_WORD_BUDGET: number;

export function countWords(text: string): number;

export function checkWordBudget(
  text: string,
  budget?: number
): { words: number; budget: number; ok: boolean };
