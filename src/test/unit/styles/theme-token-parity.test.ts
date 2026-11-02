import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Two color tokens that are equal in one theme and different in the other make
// the themes disagree about what the UI looks like: in dark, `border` equalled
// `card`, so every card, dialog, and input lost the outline it has in light.
// Each theme may pick its own values, but which tokens share a value must match.
const css = readFileSync(join(process.cwd(), "src/index.css"), "utf8");

/** The `--color-*` declarations of the first top-level block opened by `opener`. */
function colorTokens(opener: string): Map<string, string> {
  const start = css.indexOf(`\n${opener} {`);
  expect(start, opener).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("\n}", start));
  return new Map(
    [...body.matchAll(/--color-([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [
      name,
      value.replace(/\s+/g, "").toLowerCase(),
    ])
  );
}

const light = colorTokens("@theme");
const dark = new Map([...light, ...colorTokens(".dark")]);

// The accent color setting rewrites `primary*` at runtime
// (src/features/settings/accent-color.ts), so their stylesheet values say
// nothing about what the user sees.
const names = [...light.keys()].filter((name) => !name.startsWith("primary"));

describe("theme token parity", () => {
  it("defines no dark color token that light lacks", () => {
    const darkOnly = [...colorTokens(".dark").keys()].filter((name) => !light.has(name));
    expect(darkOnly).toEqual([]);
  });

  it("makes the same color tokens equal in light and dark", () => {
    const mismatches = names.flatMap((a, i) =>
      names.slice(i + 1).flatMap((b) => {
        const sameInLight = light.get(a) === light.get(b);
        const sameInDark = dark.get(a) === dark.get(b);
        if (sameInLight === sameInDark) return [];
        return [`${a} / ${b} equal only in ${sameInLight ? "light" : "dark"}`];
      })
    );
    expect(mismatches).toEqual([]);
  });
});
