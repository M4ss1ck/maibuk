// @vitest-environment node
import { describe, expect, it } from "vitest";
import { failedTests, parseStressArgs } from "../../../scripts/test-stress.mjs";

describe("parseStressArgs()", () => {
  it("defaults to three rounds and one busy loop per core, passing the rest to Vitest", () => {
    expect(parseStressArgs(["src/test/unit/a.test.ts", "--reporter=dot"], 8)).toEqual({
      rounds: 3,
      hogs: 8,
      vitestArgs: ["src/test/unit/a.test.ts", "--reporter=dot"],
    });
  });

  it("reads its own flags anywhere and drops a bare --", () => {
    expect(parseStressArgs(["--rounds", "10", "--", "a.test.ts", "--hogs", "0"], 4)).toEqual({
      rounds: 10,
      hogs: 0,
      vitestArgs: ["a.test.ts"],
    });
  });

  it("refuses a round count that is not a positive whole number", () => {
    expect(() => parseStressArgs(["--rounds", "0"], 4)).toThrow(/--rounds needs a whole number/);
    expect(() => parseStressArgs(["--hogs", "two"], 4)).toThrow(/--hogs needs a whole number/);
    expect(() => parseStressArgs(["--rounds"], 4)).toThrow(/--rounds needs a whole number/);
  });
});

describe("failedTests()", () => {
  it("lists each failing test once, with Vitest's colors stripped", () => {
    const output = [
      " \u001b[32m✓\u001b[39m src/test/unit/b.test.ts (3 tests) 5ms",
      " \u001b[41m\u001b[1m FAIL \u001b[22m\u001b[49m src/test/unit/a.test.ts\u001b[2m > \u001b[22msuite\u001b[2m > \u001b[22mlands",
      " FAIL  src/test/unit/a.test.ts > suite > lands",
      " FAIL  src/test/unit/c.test.ts [ src/test/unit/c.test.ts ]",
    ].join("\n");
    expect(failedTests(output)).toEqual(["src/test/unit/a.test.ts > suite > lands"]);
  });
});
